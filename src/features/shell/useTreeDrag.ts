import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Pointer-based drag and drop for the sidebar tree. (HTML5 drag-and-drop is unreliable in
 * Tauri on Windows, where the window intercepts OS drops for SFTP uploads.) The ghost moves
 * by writing `transform` on a ref, so dragging re-renders React only when the target
 * changes.
 *
 * Rows mark themselves as targets with data attributes:
 *   data-drop-folder="Production/EU"   a folder header ("" = top level)
 *   data-drop-host="<id>" data-folder="…" data-next="<id of next sibling | ''>"
 */
export type DragItem =
  | { type: 'host'; id: string; label: string; folder: string | null }
  | { type: 'folder'; path: string; label: string }

/** Where a drop lands: inside a folder (null = top level), before a host or at the end. */
export interface DropTarget {
  folder: string | null
  before: string | null
  /** Which row shows the indicator, and how. */
  row: string
  position: 'into' | 'before' | 'after'
}

const THRESHOLD = 5
const EDGE = 32

export function useTreeDrag(
  scroller: React.RefObject<HTMLElement | null>,
  onDrop: (item: DragItem, target: DropTarget) => void,
) {
  const [item, setItem] = useState<DragItem | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const ghost = useRef<HTMLDivElement>(null)
  /** A drag just ended: swallow the click the browser fires next. */
  const suppressClick = useRef(false)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const start = useCallback(
    (e: React.PointerEvent, dragged: DragItem) => {
      if (e.button !== 0) return
      const x0 = e.clientX
      const y0 = e.clientY
      let active = false
      let current: DropTarget | null = null
      let key = ''
      let lastY = y0
      let scrollRaf = 0

      const resolve = (x: number, y: number): DropTarget | null => {
        const el = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>('[data-drop-folder],[data-drop-host]')
        if (!el) return null
        const folderAttr = el.dataset.dropFolder
        if (folderAttr !== undefined) {
          const folder = folderAttr || null
          if (dragged.type === 'folder' && folder && isWithin(folder, dragged.path)) return null
          return { folder, before: null, row: `f:${folderAttr}`, position: 'into' }
        }
        const id = el.dataset.dropHost as string
        const folder = el.dataset.folder || null
        if (dragged.type === 'folder') {
          if (folder && isWithin(folder, dragged.path)) return null
          return { folder, before: null, row: `f:${folder ?? ''}`, position: 'into' }
        }
        if (id === dragged.id) return null
        const r = el.getBoundingClientRect()
        const after = y > r.top + r.height / 2
        return {
          folder,
          before: after ? el.dataset.next || null : id,
          row: `h:${id}`,
          position: after ? 'after' : 'before',
        }
      }

      const autoscroll = () => {
        const box = scroller.current?.getBoundingClientRect()
        if (box && active) {
          const step = lastY < box.top + EDGE ? -8 : lastY > box.bottom - EDGE ? 8 : 0
          if (step) scroller.current?.scrollBy(0, step)
        }
        scrollRaf = requestAnimationFrame(autoscroll)
      }

      const move = (ev: PointerEvent) => {
        lastY = ev.clientY
        if (!active) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return
          active = true
          setItem(dragged)
          document.documentElement.classList.add('cursor-grabbing')
          scrollRaf = requestAnimationFrame(autoscroll)
        }
        if (ghost.current)
          ghost.current.style.transform = `translate3d(${ev.clientX + 12}px, ${ev.clientY + 8}px, 0)`
        current = resolve(ev.clientX, ev.clientY)
        const k = current ? `${current.row}:${current.position}` : ''
        if (k !== key) {
          key = k
          setTarget(current)
        }
      }

      const end = (commit: boolean) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('keydown', key_)
        cancelAnimationFrame(scrollRaf)
        document.documentElement.classList.remove('cursor-grabbing')
        if (active) {
          suppressClick.current = true
          setTimeout(() => {
            suppressClick.current = false
          }, 0)
          if (commit && current) onDropRef.current(dragged, current)
        }
        setItem(null)
        setTarget(null)
      }
      const up = () => end(true)
      const key_ = (ev: KeyboardEvent) => ev.key === 'Escape' && end(false)

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('keydown', key_)
    },
    [scroller],
  )

  // Never leave the grabbing cursor behind if the sidebar unmounts mid-drag.
  useEffect(() => () => document.documentElement.classList.remove('cursor-grabbing'), [])

  return { item, target, ghost, start, suppressClick }
}

export const isWithin = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`)
