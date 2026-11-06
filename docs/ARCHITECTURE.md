# TermBee architecture

Two processes in one app: a **Rust core** (Tauri v2) that owns all I/O, and a **React UI**
in the system WebView (WebView2 on Windows, WKWebView on macOS). There is no Node
sidecar. SSH, storage and the keychain are native Rust.

```
┌──────────────── React UI (src/) ─────────────────┐       ┌──────── Rust core (src-tauri/src/) ────────┐
│ features/  shell · hosts · terminal · palette ·  │       │ hosts/    HostStore  → hosts.json          │
│            settings                              │ invoke│ secrets   keyring    → OS keychain         │
│ stores/    zustand: hosts · sessions · ui · prefs│──────▶│ ssh/      SessionManager + one task per    │
│ lib/ipc    the ONLY module that calls invoke()   │◀──────│           session (russh) · known_hosts    │
│                                                  │Channel│ rdp/      .rdp file → mstsc / Windows App  │
│                                                  │       │ sftp/     russh-sftp: files tabs, transfers│
│                                                  │       │ local     This PC pane · files: shared copy│
│                                                  │       │ store     versioned atomic JSON files      │
└──────────────────────────────────────────────────┘       └────────────────────────────────────────────┘
```

## The IPC contract

Every command is registered in `src-tauri/src/lib.rs` (`generate_handler!`), implemented in a
`commands.rs` next to its domain, and wrapped once in `src/lib/ipc/index.ts` (`api.*`). The
payload types are mirrored by hand in `src/lib/ipc/types.ts`, and each type's comment names
its Rust source. **Adding a command = Rust fn → `generate_handler!` → `api` wrapper → TS type.**
If it needs a new plugin permission, add it to `src-tauri/capabilities/default.json`.

Errors are always `{ kind, message }` (`AppError` in `error.rs`). Messages are written for
people, so the UI shows them as-is.

| Command                                      | Purpose                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `hosts_list` / `hosts_save` / `hosts_delete` | Saved hosts. `hosts_save` takes `SecretUpdate`s (`keep`/`set`/`clear`) for the password and passphrase |
| `ssh_default_key_paths`                      | Existing `~/.ssh/id_*` keys for the picker                                                             |
| `ssh_connect(request, onEvent: Channel)`     | Starts a session and returns its id. Everything else streams over the channel                          |
| `ssh_write` / `ssh_resize` / `ssh_close`     | Input, PTY size, hang up                                                                               |
| `ssh_host_key_decision`                      | Answers a paused `hostKey` event                                                                       |
| `known_hosts_list` / `known_hosts_forget`    | Trusted host keys (Settings)                                                                           |
| `rdp_open(hostId)`                           | Opens a saved RDP host in the OS client. Fails with `clientMissing` if Windows App isn't on the Mac    |
| `hosts_hive` / `hosts_move`                  | Hosts plus every folder path; drag-and-drop moves (`ids`, `folder`, `before`). Both return a `Hive`    |
| `folders_create` / `folders_move` / `folders_delete` | Folder tree edits. Move = rename or reparent with contents; delete moves contents up a level |
| `sftp_home` / `sftp_list` / `sftp_mkdir` / `sftp_rename` / `sftp_delete` | File ops on a session opened with `mode: 'sftp'` (`sessionId`) |
| `sftp_download` / `sftp_upload` / `sftp_copy` / `sftp_cancel_transfer` | Files **or folders**, streamed with a `Progress` channel (bytes + files, ≤10/s) and a cancel flag per `transferId` |
| `sftp_read` / `sftp_write_text` | First N bytes as raw `ArrayBuffer` (preview), and save text back (the editor) |
| `local_places` / `local_list` / `local_mkdir` / `local_rename` / `local_copy` / `local_trash` | The This PC pane. Delete always goes to the Recycle Bin / Trash |
| `local_read` / `local_open` / `local_reveal` | Local preview bytes, open with the default app, show in Explorer / Finder |

## Remote Desktop hosts (`rdp/`)

A host's `protocol` is `ssh` (default, so older `hosts.json` files still load) or `rdp`. RDP
hosts are password-only and never become tabs: `connectHost` in `features/hosts/lib.ts` calls
`rdp_open` instead of opening a terminal. The core writes `<temp>/termbee-rdp/<id>.rdp`
(address, username and display settings, UTF-16 with a BOM, **no secret**) and hands it to:

- **Windows**: `%SystemRoot%\System32\mstsc.exe`. A saved password is first copied to the
  `TERMSRV/<hostname>` credential (`secrets::set_rdp_login`, the same entry
  `cmdkey /generic:` writes), which mstsc reads. `HostStore` deletes that entry when the
  password is forgotten, the hostname changes, the host stops being RDP or is deleted.
- **macOS**: `open -b com.microsoft.rdc.macos` (Windows App). It can't be handed a password,
  so the editor hides the password field there and Windows App asks itself.

## Folders (`hosts/folders.rs`)

A host's `group` is its folder **path** (`Production/EU`; `null` = top level), so older
`hosts.json` files load unchanged and nesting needs no migration. Empty folders live in
`<app data>/folders.json`; `hive()` returns the union of those and every host's path plus its
ancestors. Renaming/moving a folder rewrites every path under it; deleting one moves its hosts
and subfolders up a level, so reorganizing never deletes a host. `order` is a host's position
within its folder; `hosts_move` renumbers the target folder. The sidebar (`Sidebar.tsx`) draws
the tree with `buildTree` and drags with **pointer events** (`useTreeDrag.ts`), not HTML5 DnD:
Tauri on Windows intercepts drag-and-drop for OS file drops (SFTP uploads), which breaks
in-page HTML5 dragging. Rows mark drop targets with `data-drop-folder` / `data-drop-host`.

## Files tabs (`sftp/`, `local.rs`, `files.rs`)

A files tab is an ordinary session started with `ConnectRequest.mode = 'sftp'`: the same TCP,
host-key, login and secret prompts as a shell, then the `sftp` subsystem instead of a PTY.
`session::sftp_loop` registers the `russh_sftp::SftpSession` in `SessionManager` and waits for
close, so the `sftp_*` commands borrow it by session id. It still ends with exactly one
`closed` event.

The tab has **two panes**: This PC (`local.rs`) and the server (`sftp/`). Both return the same
`FileEntry` (`files.rs`), and transfers share one `Meter` + `pump` loop (256 KB chunks,
progress at most every 100 ms, cancel checked per chunk). Folder transfers walk the tree first
(`sftp::walk`, `local::walk`, never following folder links), then move files one by one;
a failed or cancelled file is deleted, not left half-written. Every server-supplied name in a
download passes `files::safe_local_name` (no separators, `..`, or Windows-reserved
characters), so a hostile server can't write outside the target folder. Local delete is
always `trash::delete_all`. Previews read at most 2 MB of text / 20 MB of image and come back
as raw bytes (`tauri::ipc::Response`), not JSON arrays.

UI (`features/files/`): `FilesSession` wires two `FilePane`s to a `FileSource` each
(`source.ts`: `remoteSource(sessionId)` / `localSource(sep)`, plus sep-aware path helpers);
`usePane` owns history, listing, selection, filter and sort (sort/view/hidden are prefs).
Transfers: drag between panes (`useFileDrag`, pointer-based like the sidebar; targets are
`data-drop-side` + `data-drop-dir`), F5, or copy in one pane and paste in the other.
Within a pane, drag = move, Ctrl/⌥-drag or copy+paste = copy (`copyName` avoids clashes).
`useTransfers` keeps each job for Retry and smooths speed over ~2 s for the ETA;
`TransfersPanel` animates progress with `scale`, never `width`. `Preview` shows images and
text and edits remote text (≤2 MB). The server pane hosts `SessionOverlay`, so This PC stays
usable while the server connects. OS file drops (`onDragDropEvent`) land in whichever pane is
under the pointer. Rows use `content-visibility: auto`, so big folders stay cheap.

## A session's life (`ssh/session.rs`)

1. `ssh_connect` registers a `SessionHandle` (command sender + cancel `Notify`) and spawns `run`.
2. **TCP** with a 12 s timeout and `TCP_NODELAY` (no Nagle, so keystrokes go out at once).
3. **Handshake**: `check_server_key` asks `KnownHosts`. On a match it continues. If the key
   is unknown or changed, it emits `hostKey` and _awaits_ the UI's answer (a oneshot in
   `SessionManager`). Rejecting it aborts with a clear message.
4. **Auth**: password (falling back to keyboard-interactive) or key file (with passphrase).
   A missing secret emits `secretRequired`, and a rejected one emits `authFailed`. The UI
   asks and reconnects with the typed secret plus `remember`, and on success the core saves
   it to the keychain.
5. **Shell**: PTY `xterm-256color` + shell, then a `select!` loop. Output goes through a
   streaming UTF-8 decoder and out as `data` events. Input and resize arrive as commands,
   and cancel closes the channel.
6. Always ends with one `closed` event, and the handle is removed. App exit closes every
   session.

Event types are defined in `ssh/events.rs`, mirrored as `SessionEvent` in TS.

## UI structure

- `app/`: the `App` layout (title bar → sidebar | main) and window-level hotkeys.
- `features/terminal/`: `useXterm` (one xterm per tab, writes batched per frame, fit only on
  a real cols×rows change, WebGL renderer added after the font loads), `useSshSession` (the
  connection state machine; a generation counter drops events from abandoned attempts),
  and `overlays.tsx` (the connecting, host-key, secret, error and ended screens). **Tabs stay
  mounted when hidden** (`visibility: hidden`), so shells keep running and keep their size.
- `features/hosts/`: the Hive home, host cards, menus and the editor dialog.
- `features/files/`: the dual-pane files tab (`FilesSession`, `FilePane`, `Preview`, transfers).
- `components/brand/icons.tsx`: `PROTOCOLS` (SSH/SFTP/RDP icon + fixed color, shown as the badge on
  every `HexAvatar`) and `HOST_ICONS` (the picker set stored in `Host.icon`).
- `features/shell/`: the title bar (tabs, macOS traffic-light inset / Windows caption
  buttons, `data-tauri-drag-region`) and the sidebar.
- `stores/`: `hosts` (mirrors the core), `sessions` (tabs; `attempt` bumps trigger a
  reconnect), `ui` (open dialogs), `prefs` (persisted UI preferences only).
- `lib/shortcuts.ts`: one shortcut table. macOS uses ⌘. Windows uses Ctrl+Shift so shell keys
  (Ctrl+K/W/F/C) still reach the server. The terminal lets these keys bubble up to the window
  handler.

## Design system

Tokens live in `src/styles/globals.css` as CSS variables mapped into Tailwind v4
(`bg-surface`, `text-muted`, `bg-honey`, `border-line`…). There are two themes: **Hive** (dark,
default) and **Meadow** (light). Honey is the only loud color. Host accents come from
`HOST_COLORS`, and honeycomb motifs are `hex-clip` and `bg-honeycomb`. Fonts are bundled
(fontsource): Bricolage Grotesque for display, Inter for UI, JetBrains Mono for terminal and
addresses. The terminal is always dark (`features/terminal/theme.ts`).

### Motion & effects

Animations are tokens in `globals.css` (`animate-pop-in`/`pop-out` for dialogs,
`menu-in` for menus and tooltips, `rise`, `tab-in`, `slide-in`, with `--ease-out` and
`--ease-spring`). They only animate `transform`/`opacity` so the compositor does the work. In
Tailwind v4, `translate-*`/`scale-*` are their own CSS properties, so a transition must list
`translate,scale` (or use `transition-transform`); `transform` alone won't animate them.
Dialogs animate out on `data-[state=closed]`, which only works if the content stays rendered
under the Radix `Root` (no `{open && …}`).

The **Motion & effects** pref (`auto`/`full`/`reduced`, `lib/effects.ts`) sets
`<html data-effects>` before first paint. `auto` picks `reduced` when the OS asks for reduced
motion or the machine has ≤4 cores or ≤4 GB. Reduced drops animation, transitions and
`backdrop-filter`, and hides anything marked `fx-decor` (large blurs). Hidden panes
(`.invisible`) pause their animations. Avoid per-item `blur-*` filters; use gradients.

## Platform notes

- `tauri.windows.conf.json`: frameless window (`decorations: false`) with the UI's own
  caption buttons. Bundles an NSIS per-user installer.
- `tauri.macos.conf.json`: `titleBarStyle: Overlay` with native traffic lights (the title
  bar leaves 84 px for them). Bundles `.app` and `.dmg`, minimum macOS 11.
- These files are merged over `tauri.conf.json` with JSON Merge Patch, so **arrays such as
  `windows` are replaced, not merged**. Keep the window fields in sync across all three files.
- The window starts hidden and the UI shows it after the first paint (no white flash). A
  3 s fallback in `lib.rs` shows it anyway if the UI fails to load.

## Roadmap ideas

SFTP file browser (russh-sftp), port forwarding, jump hosts / ProxyJump, ssh-agent and
Pageant, split panes and broadcast input, snippets, encrypted export/import, signed
releases and auto-update, and importing hosts from `~/.ssh/config` or MyDesk.
