import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EffectsPref } from '@/lib/effects'

export type ThemePref = 'hive' | 'meadow' | 'system'
export type CursorStyle = 'block' | 'bar' | 'underline'
export type FilesView = 'list' | 'grid'
export type FilesSortKey = 'name' | 'size' | 'modified' | 'type'
export interface FilesSort {
  key: FilesSortKey
  dir: 1 | -1
}

interface PrefsState {
  theme: ThemePref
  fontSize: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  sidebarOpen: boolean
  effects: EffectsPref
  /** Sidebar folders the user closed (paths). */
  collapsedFolders: string[]
  /** Files tabs: list or icon grid, dotfiles shown, column sort (shared by both panes). */
  filesView: FilesView
  filesShowHidden: boolean
  filesSort: FilesSort
  set: (patch: Partial<Omit<PrefsState, 'set'>>) => void
}

/** UI preferences only (never host data or secrets), persisted to localStorage. */
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'hive',
      fontSize: 14,
      cursorStyle: 'bar',
      cursorBlink: true,
      scrollback: 10_000,
      copyOnSelect: true,
      sidebarOpen: true,
      effects: 'auto',
      collapsedFolders: [],
      filesView: 'list',
      filesShowHidden: false,
      filesSort: { key: 'name', dir: 1 },
      set: (patch) => set(patch),
    }),
    { name: 'termbee:prefs', version: 1 },
  ),
)

export function resolveDark(theme: ThemePref): boolean {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
  return theme === 'hive'
}
