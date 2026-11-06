/** Runtime platform facts. TermBee targets Windows and macOS. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)
export const isWindows = /Windows/.test(navigator.userAgent)

/** True inside the Tauri shell (false when the UI runs in a plain browser via `dev:web`). */
export const isTauri = '__TAURI_INTERNALS__' in window

/** Label for the primary modifier in shortcut hints. */
export const modKey = isMac ? '⌘' : 'Ctrl'
