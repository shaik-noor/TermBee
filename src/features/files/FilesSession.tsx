import { getCurrentWebview } from '@tauri-apps/api/webview'
import { ask } from '@tauri-apps/plugin-dialog'
import { CopyPlus, Folder, Power, RotateCw } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  IconBtn,
  SessionHeader,
  SessionOverlay,
  SwitchKindButton,
} from '@/features/terminal/sessionChrome'
import { type SessionIO, useSshSession } from '@/features/terminal/useSshSession'
import { cn } from '@/lib/cn'
import { type AppError, api, type FileEntry, type Place } from '@/lib/ipc'
import { isMac, isTauri, isWindows } from '@/lib/platform'
import { isLive, type Tab, useSessions } from '@/stores/sessions'
import { FilePane, type PaneActions } from './FilePane'
import { isImage, looksTextual } from './format'
import { Preview } from './Preview'
import {
  baseName,
  copyName,
  type FileSource,
  joinPath,
  localSource,
  parentPath,
  remoteSource,
  type Side,
} from './source'
import { TransfersPanel } from './TransfersPanel'
import { dropVerb, type FileDrag, type FileDrop, useFileDrag } from './useFileDrag'
import { usePane } from './usePane'
import { useTransfers } from './useTransfers'

/** No terminal to feed: banners are dropped and there is no size to report. */
const filesIO: SessionIO = {
  ready: () => true,
  size: () => ({ cols: 0, rows: 0 }),
  write: () => {},
  onConnected: () => {},
}

const confirmAction = async (message: string, title: string) =>
  isTauri ? ask(message, { title, kind: 'warning' }) : window.confirm(message)

const other = (s: Side): Side => (s === 'local' ? 'remote' : 'local')
const previewable = (e: FileEntry) =>
  e.kind === 'file' && (isImage(e.name) || looksTextual(e.name) || e.size < 256 * 1024)
const localSep: '/' | '\\' = isWindows ? '\\' : '/'
const pcName = isMac ? 'This Mac' : 'This PC'
const count = (n: number) => (n === 1 ? '1 item' : `${n} items`)

/**
 * A files tab: This PC on the left, the server on the right, over the same login flow as a
 * terminal tab. Drag between panes (or F5, or copy in one pane and paste in the other) to
 * transfer; drag onto a folder to move.
 */
export const FilesSession = memo(function FilesSession({
  tab,
  active,
}: {
  tab: Tab
  active: boolean
}) {
  const io = useRef(filesIO)
  const session = useSshSession(tab, io)
  const sid = session.liveId
  const { reconnect, duplicate } = useSessions.getState()

  const local = useMemo(() => localSource(localSep), [])
  const remote = useMemo(() => (sid ? remoteSource(sid) : null), [sid])
  const L = usePane(local)
  const R = usePane(remote)
  const paneOf = (s: Side) => (s === 'local' ? L : R)
  const sourceOf = (s: Side): FileSource | null => (s === 'local' ? local : remote)

  const [places, setPlaces] = useState<{ local: Place[]; remote: Place[] }>({
    local: [],
    remote: [],
  })
  const [focus, setFocus] = useState<Side>('remote')
  const [clip, setClip] = useState<{ side: Side; entries: FileEntry[]; cut: boolean } | null>(null)
  const [preview, setPreview] = useState<{ side: Side; entry: FileEntry } | null>(null)
  const [split, setSplit] = useState(50)
  const [osDrop, setOsDrop] = useState<Side | null>(null)
  const splitBox = useRef<HTMLDivElement>(null)

  // This PC starts at home; the server at the login's home (and stays put across reconnects).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per tab.
  useEffect(() => {
    void api.local
      .places()
      .then((p) => {
        setPlaces((x) => ({ ...x, local: p }))
        return L.load(p.find((x) => x.kind === 'home')?.path ?? p[0]?.path ?? '/')
      })
      .catch((e) =>
        toast.error('Couldn’t read this computer’s folders', {
          description: (e as AppError).message,
        }),
      )
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the session changes.
  useEffect(() => {
    if (!remote) return
    void remote.places().then((p) => setPlaces((x) => ({ ...x, remote: p })))
    if (R.cwd) void R.load(R.cwd, true)
    else
      void remote
        .home()
        .then((h) => R.load(h))
        .catch(() => R.load('/'))
  }, [remote])

  const tx = useTransfers((job) => {
    if (job.kind === 'download') void L.refresh()
    else void R.refresh()
  })

  // --- operations

  const clashes = (entries: FileEntry[], side: Side, dir: string) => {
    const pane = paneOf(side)
    if (dir !== pane.cwd) return []
    const names = new Set(pane.entries.map((e) => e.name))
    return entries.filter((e) => names.has(e.name))
  }

  const transfer = async (entries: FileEntry[], from: Side, dir?: string) => {
    const to = other(from)
    const target = dir ?? paneOf(to).cwd
    if (!sid || !target || entries.length === 0) return
    const clash = clashes(entries, to, target)
    if (
      clash.length &&
      !(await confirmAction(
        `${clash.length === 1 ? `“${clash[0].name}” already exists` : `${clash.length} items already exist`} in ${target}. Replace ${clash.length === 1 ? 'it' : 'them'}?`,
        'Replace?',
      ))
    )
      return
    for (const e of entries) {
      if (from === 'local')
        void tx.start({
          kind: 'upload',
          sessionId: sid,
          from: e.path,
          to: joinPath('/', target, e.name),
        })
      else void tx.start({ kind: 'download', sessionId: sid, from: e.path, toDir: target })
    }
  }

  const moveWithin = async (side: Side, entries: FileEntry[], dir: string) => {
    const src = sourceOf(side)
    if (!src) return
    for (const e of entries) {
      if (parentPath(src.sep, e.path) === dir) continue
      try {
        await src.rename(e.path, joinPath(src.sep, dir, e.name))
      } catch (err) {
        toast.error(`Couldn’t move ${e.name}`, { description: (err as AppError).message })
      }
    }
    void paneOf(side).refresh()
  }

  const copyWithin = async (side: Side, entries: FileEntry[], dir: string) => {
    const src = sourceOf(side)
    const pane = paneOf(side)
    if (!src) return
    const taken = new Set(dir === pane.cwd ? pane.entries.map((e) => e.name) : [])
    for (const e of entries) {
      const name = taken.has(e.name) ? copyName(e.name, taken) : e.name
      taken.add(name)
      const to = joinPath(src.sep, dir, name)
      if (side === 'remote' && sid)
        void tx.start({ kind: 'copy', sessionId: sid, from: e.path, to })
      else
        await api.local
          .copy(e.path, to)
          .catch((err) =>
            toast.error(`Couldn’t copy ${e.name}`, { description: (err as AppError).message }),
          )
    }
    if (side === 'local') void L.refresh()
  }

  const onDrop = (d: FileDrag, t: FileDrop) => {
    if (d.side !== t.side) void transfer(d.entries, d.side, t.dir)
    else if (t.copy) void copyWithin(t.side, d.entries, t.dir)
    else void moveWithin(t.side, d.entries, t.dir)
  }
  const drag = useFileDrag(onDrop)

  const actionsFor = (side: Side): PaneActions => {
    const pane = paneOf(side)
    const src = sourceOf(side)
    return {
      open: (e) => {
        if (e.kind === 'dir') void pane.go(e.path)
        else if (previewable(e)) setPreview({ side, entry: e })
        else if (side === 'local') void api.local.open(e.path)
        else void transfer([e], 'remote')
      },
      preview: (e) => {
        if (e.kind !== 'dir') setPreview({ side, entry: e })
      },
      transfer: (entries) => void transfer(entries, side),
      copy: (entries, cut) => {
        setClip({ side, entries, cut })
        toast(`${cut ? 'Cut' : 'Copied'} ${count(entries.length)}`, {
          description: `Paste in either pane. Pasting into ${side === 'local' ? 'the server uploads' : `${pcName} downloads`}.`,
          duration: 2200,
        })
      },
      canPaste: !!clip,
      paste: () => {
        const dir = pane.cwd
        if (!clip || !dir) return
        if (clip.side !== side) void transfer(clip.entries, clip.side, dir)
        else if (clip.cut) {
          void moveWithin(side, clip.entries, dir)
          setClip(null)
        } else void copyWithin(side, clip.entries, dir)
      },
      remove: async (entries) => {
        if (!src || entries.length === 0) return
        if (side === 'remote') {
          const dirs = entries.some((e) => e.kind === 'dir')
          const ok = await confirmAction(
            `Delete ${entries.length === 1 ? `“${entries[0].name}”` : count(entries.length)} from the server?${dirs ? ' Folders are deleted with everything inside.' : ''} This can’t be undone.`,
            'Delete from server',
          )
          if (!ok) return
        }
        try {
          await src.remove(entries)
          if (side === 'local')
            toast(`Moved ${count(entries.length)} to the ${isMac ? 'Trash' : 'Recycle Bin'}`, {
              duration: 1800,
            })
        } catch (e) {
          toast.error('Couldn’t delete', { description: (e as AppError).message })
        }
        void pane.refresh()
      },
      rename: async (e, name) => {
        if (!src || !pane.cwd) return
        if (/[\\/]/.test(name)) {
          toast.error('Names can’t contain “/” or “\\”')
          return
        }
        try {
          const to = joinPath(src.sep, pane.cwd, name)
          await src.rename(e.path, to)
          await pane.refresh()
          pane.selectOnly(to)
        } catch (err) {
          toast.error(`Couldn’t rename ${e.name}`, { description: (err as AppError).message })
        }
      },
      mkdir: async (name) => {
        if (!src || !pane.cwd) return
        try {
          const path = joinPath(src.sep, pane.cwd, name)
          await src.mkdir(path)
          await pane.refresh()
          pane.selectOnly(path)
        } catch (err) {
          toast.error('Couldn’t create the folder', { description: (err as AppError).message })
        }
      },
      ...(side === 'local'
        ? {
            openWithApp: (e: FileEntry) => void api.local.open(e.path),
            reveal: (e: FileEntry) => void api.local.reveal(e.path),
          }
        : {}),
    }
  }

  // --- files dropped from Explorer / Finder: into whichever pane they land on

  const osDropRef = useRef<(paths: string[], side: Side, dir: string) => void>(() => {})
  osDropRef.current = (paths, side, dir) => {
    const entries = paths.map(
      (p): FileEntry => ({
        name: baseName(p),
        path: p,
        kind: 'file',
        link: false,
        hidden: false,
        size: 0,
        modified: null,
        permissions: null,
      }),
    )
    if (side === 'remote') void transfer(entries, 'local', dir)
    else void copyWithin('local', entries, dir)
  }
  useEffect(() => {
    if (!isTauri || !active) return
    const at = (pos: { x: number; y: number }) => {
      const el = document
        .elementFromPoint(pos.x / devicePixelRatio, pos.y / devicePixelRatio)
        ?.closest<HTMLElement>('[data-drop-side]')
      return el ? { side: el.dataset.dropSide as Side, dir: el.dataset.dropDir as string } : null
    }
    let unlisten: (() => void) | undefined
    let disposed = false
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        const p = ev.payload
        if (p.type === 'leave') {
          setOsDrop(null)
          return
        }
        const hit = at(p.position)
        if (p.type === 'drop') {
          setOsDrop(null)
          if (hit?.dir) osDropRef.current(p.paths, hit.side, hit.dir)
        } else setOsDrop(hit?.side ?? null)
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
    return () => {
      disposed = true
      unlisten?.()
      setOsDrop(null)
    }
  }, [active])

  // --- resizable split

  const startSplit = useCallback((e: React.PointerEvent) => {
    const box = splitBox.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    const move = (ev: PointerEvent) =>
      setSplit(Math.min(75, Math.max(25, ((ev.clientX - box.left) / box.width) * 100)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.documentElement.classList.remove('cursor-col-resize')
    }
    document.documentElement.classList.add('cursor-col-resize')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  const live = isLive(tab.status)
  const previewSource = preview ? sourceOf(preview.side) : null

  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col bg-bg',
        !active && 'invisible pointer-events-none',
      )}
      aria-hidden={!active}
    >
      <SessionHeader tab={tab}>
        <SwitchKindButton tab={tab} />
        <IconBtn label="Duplicate tab" onClick={() => duplicate(tab.id)}>
          <CopyPlus />
        </IconBtn>
        {live ? (
          <IconBtn label="Disconnect" onClick={session.disconnect} danger>
            <Power />
          </IconBtn>
        ) : (
          <IconBtn label="Reconnect" onClick={() => reconnect(tab.id)}>
            <RotateCw />
          </IconBtn>
        )}
      </SessionHeader>

      <div ref={splitBox} className="flex min-h-0 flex-1">
        <div
          className={cn(
            'relative flex min-w-0',
            osDrop === 'local' && 'ring-2 ring-honey ring-inset',
          )}
          style={{ width: `${split}%` }}
        >
          <FilePane
            pane={L}
            title={pcName}
            places={places.local}
            focused={focus === 'local'}
            onFocus={() => setFocus('local')}
            drag={drag}
            actions={actionsFor('local')}
            otherLabel={tab.target.label}
          />
        </div>
        {/* A draggable splitter; double-click resets it. */}
        <div
          aria-hidden="true"
          onPointerDown={startSplit}
          onDoubleClick={() => setSplit(50)}
          className="group relative w-px shrink-0 cursor-col-resize bg-line"
        >
          <span className="absolute inset-y-0 -right-1 -left-1 transition-colors group-hover:bg-honey/30" />
        </div>
        <div
          className={cn(
            'relative flex min-w-0 flex-1',
            osDrop === 'remote' && 'ring-2 ring-honey ring-inset',
          )}
        >
          <FilePane
            pane={R}
            title={tab.target.label}
            places={places.remote}
            focused={focus === 'remote'}
            onFocus={() => setFocus('remote')}
            drag={drag}
            actions={actionsFor('remote')}
            otherLabel={pcName}
          />
          {/* Connecting / login screens cover the server pane only: This PC stays usable. */}
          <SessionOverlay tab={tab} session={session} />
        </div>
      </div>

      <TransfersPanel
        transfers={tx.transfers}
        onCancel={tx.cancel}
        onRetry={tx.retry}
        onDismiss={tx.dismiss}
        onClear={tx.clearFinished}
      />

      {previewSource && (
        <Preview
          entry={preview?.entry ?? null}
          source={previewSource}
          sessionId={sid}
          onClose={() => setPreview(null)}
          onSaved={() => void R.refresh()}
        />
      )}

      {drag.drag &&
        createPortal(
          <div
            ref={drag.ghost}
            className="pointer-events-none fixed top-0 left-0 z-[60] flex items-center gap-2 rounded-lg border border-honey/50 bg-surface px-2.5 py-1.5 text-xs font-medium shadow-glow will-change-transform"
          >
            <Folder className="size-3.5 fill-honey/25 text-honey" />
            {drag.drag.entries.length === 1
              ? drag.drag.entries[0].name
              : count(drag.drag.entries.length)}
            {drag.target && (
              <span className="font-normal text-subtle">
                {dropVerb(drag.drag, drag.target)} {baseName(drag.target.dir) || drag.target.dir}
              </span>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
})
