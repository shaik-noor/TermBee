import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry } from '@/lib/ipc'
import type { Side } from './source'

/**
 * Pointer-based dragging of selected files (HTML5 drag-and-drop doesn't work under Tauri's
 * file-drop handler on Windows). Drop targets mark themselves with
 * `data-drop-side="local|remote"` and `data-drop-dir="<folder path>"`: a pane's background
 * targets its current folder, a folder row targets that folder. The ghost moves via
 * `transform` on a ref, so React re-renders only when the target changes.
 */
export interface FileDrag {
  side: Side
  entries: FileEntry[]
}

export interface FileDrop {
  side: Side
  dir: string
  /** Ctrl/⌥ held: copy instead of move (same side only). */
  copy: boolean
}

const THRESHOLD = 5

export function useFileDrag(onDrop: (drag: FileDrag, drop: FileDrop) => void) {
  const [drag, setDrag] = useState<FileDrag | null>(null)
  const [target, setTarget] = useState<FileDrop | null>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const start = useCallback((e: React.PointerEvent, dragged: FileDrag) => {
    if (e.button !== 0 || dragged.entries.length === 0) return
    const x0 = e.clientX
    const y0 = e.clientY
    let active = false
    let current: FileDrop | null = null
    let key = ''

    const resolve = (ev: PointerEvent): FileDrop | null => {
      const el = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-drop-side]')
      if (!el) return null
      const side = el.dataset.dropSide as Side
      const dir = el.dataset.dropDir as string
      // Not onto itself, and not a folder into its own subtree.
      if (dragged.entries.some((d) => d.path === dir)) return null
      if (
        side === dragged.side &&
        dragged.entries.some((d) => dir.startsWith(d.path + (d.path.includes('\\') ? '\\' : '/')))
      )
        return null
      return { side, dir, copy: ev.ctrlKey || ev.altKey }
    }

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return
        active = true
        setDrag(dragged)
        document.documentElement.classList.add('cursor-grabbing')
      }
      if (ghost.current)
        ghost.current.style.transform = `translate3d(${ev.clientX + 14}px, ${ev.clientY + 10}px, 0)`
      current = resolve(ev)
      const k = current ? `${current.side}:${current.dir}:${current.copy}` : ''
      if (k !== key) {
        key = k
        setTarget(current)
      }
    }
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', esc)
      document.documentElement.classList.remove('cursor-grabbing')
      if (active) {
        suppressClick.current = true
        setTimeout(() => {
          suppressClick.current = false
        }, 0)
        if (commit && current) onDropRef.current(dragged, current)
      }
      setDrag(null)
      setTarget(null)
    }
    const up = () => end(true)
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && end(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', esc)
  }, [])

  useEffect(() => () => document.documentElement.classList.remove('cursor-grabbing'), [])

  return { drag, target, ghost, start, suppressClick }
}

export type FileDragApi = ReturnType<typeof useFileDrag>

/** What the ghost says a drop will do. */
export function dropVerb(drag: FileDrag, drop: FileDrop): string {
  if (drag.side !== drop.side) return drop.side === 'remote' ? 'Upload to' : 'Download to'
  return drop.copy ? 'Copy to' : 'Move to'
}
