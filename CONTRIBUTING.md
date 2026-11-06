# Contributing to TermBee

Thanks for helping out! TermBee is a Tauri v2 app: a Rust core (`src-tauri/`) that owns all
I/O, and a React 19 + Vite + Tailwind v4 UI (`src/`). Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing code. It explains the IPC
contract, the session lifecycle and the design tokens.

## Getting started

1. Fork the repo and clone your fork:

   ```bash
   git clone https://github.com/<you>/TermBee.git
   cd TermBee
   npm install
   ```

2. Install the prerequisites from the [README](README.md#develop) (Node 24+, Rust stable,
   and the platform's Tauri prerequisites).
3. Run the app with `npm run dev`, or just the UI with `npm run dev:web` (a mock backend,
   no SSH needed — good for UI work).

## Making a change

1. Create a branch off `main`: `git checkout -b fix/short-description`.
2. Keep each commit focused on one thing, with a message in the
   [Conventional Commits](https://www.conventionalcommits.org) style used in the history:
   `feat(ssh): …`, `fix(files): …`, `docs: …`, `chore: …`, `ci: …`.
3. Run the checks before opening a pull request (CI does not run them automatically):

   ```bash
   npm run typecheck && npm run lint
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

   `npm run check` fixes most lint and formatting issues in the UI. Use `cargo fmt` for Rust.
4. Update `docs/ARCHITECTURE.md` and the README when you change a command, an event, a
   store, a design token or the build.
5. Open a pull request against `main` and describe what changed and how you tested it.
   Screenshots help for UI changes.

## House rules

- **Secrets never touch disk or the UI.** Passwords and passphrases go only through
  `src-tauri/src/secrets.rs` (the OS keychain).
- **Only `src/lib/ipc/` calls `invoke`.** When you add an IPC command, also add its type in
  `src/lib/ipc/types.ts` and a case in `src/lib/ipc/mock.ts` so `dev:web` keeps working.
  The full checklist is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Every SSH session ends with exactly one `closed` event.
- Don't regress terminal speed: one xterm per tab, writes batched per frame.
- Use the design tokens from `src/styles/globals.css` (`bg-surface`, `text-muted`,
  `bg-honey`…), never raw colors. Animate only `transform`/`opacity`.
- App shortcuts live in `src/lib/shortcuts.ts`. On Windows they use Ctrl+Shift and must not
  take plain Ctrl+letter keys that shells need.
- Style: Biome for the UI (no semicolons, single quotes, width 100), `cargo fmt` for Rust.

## Reporting bugs and ideas

Open an issue with your OS, the TermBee version, what you expected and what happened. For
SSH problems, mention the server (OpenSSH version if you know it) and the auth method, but
never paste passwords, private keys or real host names you'd rather keep private.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
