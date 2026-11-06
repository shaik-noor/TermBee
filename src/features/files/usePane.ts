import { useCallback, useMemo, useRef, useState } from 'react'
import type { AppError, FileEntry } from '@/lib/ipc'
import { type FilesSort, usePrefs } from '@/stores/prefs'
import { type FileSource, parentPath } from './source'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const ext = (n: string) => (n.lastIndexOf('.') > 0 ? n.slice(n.lastIndexOf('.') + 1) : '')

/** Folders first, then the chosen column; ties fall back to the name. */
export function sortEntries(list: FileEntry[], { key, dir }: FilesSort): FileEntry[] {
  return [...list].sort((a, b) => {
    const folders = Number(b.kind === 'dir') - Number(a.kind === 'dir')
    if (folders) return folders
    let c = 0
    if (key === 'size') c = a.size - b.size
    else if (key === 'modified') c = (a.modified ?? 0) - (b.modified ?? 0)
    else if (key === 'type') c = collator.compare(ext(a.name), ext(b.name))
    return (c || collator.compare(a.name, b.name)) * dir
  })
}

/** Navigation, listing, selection and filtering for one pane. */
export function usePane(source: FileSource | null) {
  const [cwd, setCwd] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const history = useRef<{ back: string[]; forward: string[] }>({ back: [], forward: [] })
  const [, bumpHistory] = useState(0)
  const anchor = useRef(-1)
  const sort = usePrefs((s) => s.filesSort)
  const showHidden = usePrefs((s) => s.filesShowHidden)

  const load = useCallback(
    async (path: string, keepSelection = false) => {
      if (!source) return false
      setLoading(true)
      try {
        const rows = await source.list(path)
        setCwd(path)
        setEntries(rows)
        setError(null)
        if (!keepSelection) {
          setSelected(new Set())
          anchor.current = -1
        }
        return true
      } catch (e) {
        setError((e as AppError).message)
        return false
      } finally {
        setLoading(false)
      }
    },
    [source],
  )

  /** Opens a folder, remembering where we came from for Back. */
  const go = useCallback(
    async (path: string) => {
      const from = cwd
      if (path === from) return
      if (await load(path)) {
        if (from) history.current.back.push(from)
        history.current.forward = []
        setFilter('')
        bumpHistory((n) => n + 1)
      }
    },
    [cwd, load],
  )

  const back = useCallback(async () => {
    const to = history.current.back.pop()
    if (!to) return
    if (cwd) history.current.forward.push(cwd)
    await load(to)
    bumpHistory((n) => n + 1)
  }, [cwd, load])

  const forward = useCallback(async () => {
    const to = history.current.forward.pop()
    if (!to) return
    if (cwd) history.current.back.push(cwd)
    await load(to)
    bumpHistory((n) => n + 1)
  }, [cwd, load])

  const up = useCallback(() => {
    const p = cwd && source ? parentPath(source.sep, cwd) : null
    if (p) void go(p)
  }, [cwd, source, go])

  const refresh = useCallback(() => (cwd ? load(cwd, true) : Promise.resolve(false)), [cwd, load])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return sortEntries(
      entries.filter((e) => (showHidden || !e.hidden) && (!q || e.name.toLowerCase().includes(q))),
      sort,
    )
  }, [entries, filter, showHidden, sort])

  const selection = useMemo(() => visible.filter((e) => selected.has(e.path)), [visible, selected])

  /** Click, Ctrl/⌘-click and Shift-click selection over the visible rows. */
  const click = useCallback(
    (ev: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, index: number) => {
      const e = visible[index]
      if (!e) return
      if (ev.shiftKey && anchor.current >= 0) {
        const [a, b] = [anchor.current, index].sort((x, y) => x - y)
        setSelected(new Set(visible.slice(a, b + 1).map((r) => r.path)))
        return
      }
      anchor.current = index
      if (ev.ctrlKey || ev.metaKey)
        setSelected((s) => {
          const next = new Set(s)
          if (next.has(e.path)) next.delete(e.path)
          else next.add(e.path)
          return next
        })
      else setSelected(new Set([e.path]))
    },
    [visible],
  )

  const selectOnly = useCallback(
    (path: string | null) => {
      setSelected(new Set(path ? [path] : []))
      anchor.current = path ? visible.findIndex((e) => e.path === path) : -1
    },
    [visible],
  )

  return {
    source,
    cwd,
    entries,
    visible,
    loading,
    error,
    selected,
    selection,
    filter,
    setFilter,
    setSelected,
    load,
    go,
    back,
    forward,
    up,
    refresh,
    click,
    selectOnly,
    canBack: history.current.back.length > 0,
    canForward: history.current.forward.length > 0,
  }
}

export type Pane = ReturnType<typeof usePane>
