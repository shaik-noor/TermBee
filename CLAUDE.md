# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TermBee: a cross-platform (Windows + macOS) SSH terminal built on Tauri v2. A Rust core
(`src-tauri/`, russh + keyring) owns all I/O, and a React 19 + Vite + Tailwind v4 UI (`src/`)
runs in the system WebView. There is no Node sidecar.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing code. It explains the IPC
contract, the session lifecycle and the design tokens. Keep it (and the README) in sync when
you change a command, an event, a store, a token or the build.

## Commands

```bash
npm run dev            # desktop app (tauri dev)
npm run dev:web        # UI only in a browser on :1420 with a mock backend (src/lib/ipc/mock.ts)
npm run typecheck      # tsc -b
npm run lint           # biome lint .   (npm run check = lint + format --write)
npm run check:rust     # cargo check
npm run build          # installers for the current OS (macOS can't be built from Windows)
npm run icons          # regenerate src-tauri/icons from assets/brand/termbee-icon.svg
```

Before calling a change done, run the same checks as CI (`.github/workflows/build.yml`):

```bash
npm run typecheck && npm run lint
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

There is no JS test runner. Rust tests are the `utf8.rs` unit tests plus
`src-tauri/tests/ssh_live.rs`, which drives a real session without a window through the
`termbee_lib::testing` rig. Run one test by name filter, e.g.
`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_live refused_port`. The live
connect test is skipped unless `TERMBEE_TEST_HOST`/`PORT`/`USER`/`PASSWORD` are set (see the
README for a Docker sshd one-liner).

## Architecture in brief

- **Adding an IPC command**: Rust fn in the domain's `commands.rs` → register in
  `generate_handler!` in `src-tauri/src/lib.rs` → `api.*` wrapper in `src/lib/ipc/index.ts` →
  hand-mirrored type in `src/lib/ipc/types.ts` (comment names the Rust source) → case in
  `mock.ts`. New plugin permissions go in `src-tauri/capabilities/default.json`.
- Errors cross IPC as `{ kind, message }` (`AppError` in `error.rs`). Messages are written
  for people and shown as-is in the UI.
- `ssh_connect` returns a session id, and everything after streams over a `Channel` as
  `SessionEvent`s (`ssh/events.rs`). `hostKey` pauses the session until
  `ssh_host_key_decision` answers it. `secretRequired`/`authFailed` make the UI reconnect
  with a typed secret.
- UI side: `useSshSession` is the connection state machine (a generation counter drops events
  from abandoned attempts), and bumping `attempt` in the `sessions` store triggers a reconnect.
  Terminal tabs stay mounted when hidden (`visibility: hidden`) so shells keep running.
- Platform configs `tauri.windows.conf.json` / `tauri.macos.conf.json` are JSON Merge Patched
  over `tauri.conf.json`, so arrays like `windows` are **replaced**. Keep window fields in sync
  across all three files.

## Rules

- **Secrets never touch disk or the UI.** Passwords and passphrases go only through
  `secrets.rs` (OS keychain). The UI sees just `savedSecrets` flags.
- **Only `src/lib/ipc/` calls `invoke`.** Keep the mock in step so `dev:web` keeps working.
- Every SSH session ends with exactly one `closed` event. Keep that invariant in `session.rs`.
- Don't regress terminal speed: one xterm per tab created once, writes batched per frame,
  fit deduped, WebGL after font load, `TCP_NODELAY` on.
- Use the design tokens (`bg-surface`, `text-muted`, `bg-honey`…, defined in
  `src/styles/globals.css`), never raw colors. The exception is the always-dark terminal
  surfaces in `features/terminal/`.
- Motion must stay cheap on low-end PCs: animate only transform/opacity with the `animate-*`
  tokens, no per-item `blur-*` filters, and mark big decorative blurs `fx-decor` so the
  Reduced effects mode drops them. Tailwind v4's `translate-*`/`scale-*` need
  `transition-[…,translate,scale]`; `transform` in the list won't animate them.
- RDP hosts never open a tab: `connectHost` hands them to `rdp_open` (OS client). Never put
  a password in the `.rdp` file or on a command line; on Windows it goes through
  `secrets::set_rdp_login` (`TERMSRV/<host>`).
- A files tab is an SSH session with `mode: 'sftp'`; reuse `useSshSession` + `sessionChrome`
  rather than a second login flow. Sanitize any server-supplied name before it touches the
  local disk (`files::safe_local_name`). Local deletes go to the trash only, and previews
  stay capped (they return raw bytes via `ipc::Response`).
- Folders are paths in `Host.group`; never delete hosts when reorganizing. Sidebar drag and
  drop is pointer-based on purpose (HTML5 DnD breaks under Tauri's file-drop handler).
- App shortcuts go in `lib/shortcuts.ts`. On Windows they use Ctrl+Shift and must not take
  plain Ctrl+letter keys that shells need.
- `russh` uses the `ring` backend (no CMake/NASM needed). Don't re-enable `aws-lc-rs`.
- Style: Biome. No semicolons, single quotes, width 100. `cargo fmt` for Rust.
