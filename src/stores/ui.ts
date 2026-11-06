import { create } from 'zustand'
import type { Host } from '@/lib/ipc'

/** Which global dialogs are open. Keeps feature components decoupled from each other. */
interface UiState {
  paletteOpen: boolean
  settingsOpen: boolean
  /** `null` = closed, `'new'` = create, a Host = edit. */
  editing: Host | 'new' | null
  /** Prefill for a new host (e.g. from quick connect). */
  draft: Partial<Host> | null
  /** Bumped on every open, so the editor form starts fresh each time. */
  editorSeq: number
  setPalette: (open: boolean) => void
  setSettings: (open: boolean) => void
  editHost: (host: Host | 'new' | null, draft?: Partial<Host> | null) => void
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  editing: null,
  draft: null,
  editorSeq: 0,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  editHost: (editing, draft = null) =>
    set((s) => ({
      editing,
      draft,
      paletteOpen: false,
      editorSeq: editing ? s.editorSeq + 1 : s.editorSeq,
    })),
}))
