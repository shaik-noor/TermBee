import { isMac } from './platform'

/**
 * App shortcuts. On macOS they use ⌘ (never reaches the shell). On Windows they use
 * Ctrl+Shift so they don't steal shell keys like Ctrl+K, Ctrl+W, Ctrl+F.
 */
export type ShortcutId =
  | 'palette'
  | 'newTab'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'find'
  | 'newHost'
  | 'settings'
  | 'sidebar'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'copy'
  | 'paste'

interface Combo {
  key: string
  mod?: boolean // ⌘ on mac, Ctrl on Windows
  shift?: boolean
  ctrl?: boolean // literal Ctrl on both
}

const winShift = (key: string): Combo =>
  isMac ? { key, mod: true } : { key, mod: true, shift: true }

const MAP: Record<ShortcutId, Combo> = {
  palette: isMac ? { key: 'k', mod: true } : { key: 'p', mod: true, shift: true },
  newTab: winShift('t'),
  closeTab: winShift('w'),
  nextTab: { key: 'Tab', ctrl: true },
  prevTab: { key: 'Tab', ctrl: true, shift: true },
  find: winShift('f'),
  newHost: winShift('n'),
  settings: { key: ',', mod: true },
  sidebar: winShift('b'),
  zoomIn: { key: '=', mod: true },
  zoomOut: { key: '-', mod: true },
  zoomReset: { key: '0', mod: true },
  copy: winShift('c'),
  paste: winShift('v'),
}

export function matches(e: KeyboardEvent, id: ShortcutId): boolean {
  const c = MAP[id]
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const want = c.key === '=' ? key === '=' || key === '+' : key === c.key
  if (!want) return false
  const modDown = isMac ? e.metaKey : e.ctrlKey
  if (c.ctrl) return e.ctrlKey && !e.metaKey && !!c.shift === e.shiftKey
  if (c.mod && !modDown) return false
  if (!c.mod && modDown) return false
  if (c.key !== '=' && !!c.shift !== e.shiftKey) return false
  return !e.altKey
}

export function matchAny(e: KeyboardEvent): ShortcutId | null {
  for (const id of Object.keys(MAP) as ShortcutId[]) if (matches(e, id)) return id
  return null
}

/** Human label, e.g. "⌘K" or "Ctrl+Shift+P". */
export function label(id: ShortcutId): string {
  const c = MAP[id]
  const key = c.key === 'Tab' ? 'Tab' : c.key === ',' ? ',' : c.key.toUpperCase()
  if (isMac) return `${c.ctrl ? '⌃' : ''}${c.shift ? '⇧' : ''}${c.mod ? '⌘' : ''}${key}`
  return [c.ctrl || c.mod ? 'Ctrl' : null, c.shift ? 'Shift' : null, key].filter(Boolean).join('+')
}
