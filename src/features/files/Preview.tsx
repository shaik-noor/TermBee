import { ask } from '@tauri-apps/plugin-dialog'
import { Eye, FileWarning, Loader2, Pencil, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { type AppError, api, type FileEntry } from '@/lib/ipc'
import { isMac, isTauri } from '@/lib/platform'
import { formatDate, formatSize, imageMime, isImage } from './format'
import type { FileSource } from './source'

const TEXT_MAX = 2 * 1024 * 1024
const IMAGE_MAX = 20 * 1024 * 1024

type Loaded =
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'binary' }
  | { kind: 'error'; message: string }

/** NUL bytes in the first 8 KB: treat as binary, like git does. */
const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 8192).includes(0)

/**
 * Quick look at a file from either pane: images inline, text with line numbers. Text files on
 * the server (up to 2 MB) can be edited and saved back with ⌘/Ctrl+S.
 */
export function Preview({
  entry,
  source,
  sessionId,
  onClose,
  onSaved,
}: {
  entry: FileEntry | null
  source: FileSource
  sessionId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [shown, setShown] = useState(entry)
  if (entry && entry !== shown) setShown(entry)
  const [dirty, setDirty] = useState(false)

  const close = async () => {
    if (dirty) {
      const msg = 'Discard your unsaved changes?'
      const ok = isTauri
        ? await ask(msg, { title: 'Unsaved changes', kind: 'warning' })
        : window.confirm(msg)
      if (!ok) return
    }
    setDirty(false)
    onClose()
  }

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && void close()}>
      {shown && (
        <DialogContent
          title={shown.name}
          description={`${formatSize(shown.size)} · ${formatDate(shown.modified)}${shown.permissions ? ` · ${shown.permissions}` : ''}`}
          icon={<Eye />}
          className="w-[min(960px,calc(100vw-48px))]"
        >
          <PreviewBody
            key={shown.path}
            entry={shown}
            source={source}
            sessionId={sessionId}
            onDirty={setDirty}
            onSaved={onSaved}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

function PreviewBody({
  entry,
  source,
  sessionId,
  onDirty,
  onSaved,
}: {
  entry: FileEntry
  source: FileSource
  sessionId: string | null
  onDirty: (d: boolean) => void
  onSaved: () => void
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const editor = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) editor.current?.focus({ preventScroll: true })
  }, [editing])

  useEffect(() => {
    let url: string | null = null
    let gone = false
    const image = isImage(entry.name)
    source
      .read(entry.path, image ? IMAGE_MAX : TEXT_MAX)
      .then((buf) => {
        if (gone) return
        const bytes = new Uint8Array(buf)
        if (image) {
          url = URL.createObjectURL(new Blob([bytes], { type: imageMime(entry.name) }))
          setLoaded({ kind: 'image', url })
        } else if (isBinary(bytes)) setLoaded({ kind: 'binary' })
        else
          setLoaded({
            kind: 'text',
            text: new TextDecoder().decode(bytes),
            truncated: entry.size > bytes.length,
          })
      })
      .catch((e) => !gone && setLoaded({ kind: 'error', message: (e as AppError).message }))
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [entry, source])

  const canEdit =
    source.side === 'remote' && !!sessionId && loaded.kind === 'text' && !loaded.truncated
  const text = loaded.kind === 'text' ? loaded.text : ''
  const lines = useMemo(() => (editing ? draft : text).split('\n').length, [editing, draft, text])

  const save = async () => {
    if (!sessionId || saving) return
    setSaving(true)
    try {
      await api.sftp.writeText(sessionId, entry.path, draft)
      setLoaded({ kind: 'text', text: draft, truncated: false })
      onDirty(false)
      onSaved()
      toast.success(`Saved ${entry.name}`, { duration: 1500 })
    } catch (e) {
      toast.error(`Couldn’t save ${entry.name}`, { description: (e as AppError).message })
    } finally {
      setSaving(false)
    }
  }

  if (loaded.kind === 'loading')
    return (
      <div className="grid h-64 place-items-center text-subtle">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  if (loaded.kind === 'error' || loaded.kind === 'binary')
    return (
      <div className="grid h-48 place-items-center text-center text-sm text-subtle">
        <div>
          <FileWarning className="mx-auto mb-2 size-6" />
          {loaded.kind === 'error'
            ? loaded.message
            : 'This looks like a binary file, so there’s no preview. Download it to open it.'}
        </div>
      </div>
    )
  if (loaded.kind === 'image')
    return (
      <div className="grid min-h-64 place-items-center rounded-xl bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,var(--surface)_0%_50%)] bg-[length:20px_20px] p-4">
        <img src={loaded.url} alt={entry.name} className="max-h-[60vh] max-w-full object-contain" />
      </div>
    )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-subtle">
        <span className="tabular-nums">
          {lines.toLocaleString()} {lines === 1 ? 'line' : 'lines'}
        </span>
        {loaded.truncated && <span>· showing the first 2 MB</span>}
        <div className="ml-auto flex items-center gap-2">
          {editing ? (
            <>
              <span className="hidden sm:inline">
                <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>S</Kbd> to save
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  onDirty(false)
                }}
              >
                Cancel
              </Button>
              <Button size="sm" variant="honey" onClick={() => void save()} disabled={saving}>
                <Save /> {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft(text)
                  setEditing(true)
                }}
              >
                <Pencil /> Edit
              </Button>
            )
          )}
        </div>
      </div>
      <div className="flex max-h-[62vh] min-h-64 overflow-auto rounded-xl border border-line bg-surface-2/50 font-mono text-[12.5px] leading-5">
        {/* Line numbers render as one text block: cheap even for long files. */}
        <pre className="sticky left-0 shrink-0 border-r border-line bg-surface-2 px-3 py-3 text-right text-subtle select-none">
          {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
        </pre>
        {editing ? (
          <textarea
            value={draft}
            ref={editor}
            spellCheck={false}
            wrap="off"
            rows={lines}
            onChange={(e) => {
              setDraft(e.target.value)
              onDirty(e.target.value !== text)
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault()
                void save()
              }
              if (e.key === 'Tab') {
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: a, selectionEnd: b } = el
                const next = `${draft.slice(0, a)}  ${draft.slice(b)}`
                setDraft(next)
                onDirty(next !== text)
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
              }
            }}
            className={cn(
              // Sized to its lines so the shared container scrolls numbers and text together.
              'selectable flex-1 resize-none overflow-y-hidden bg-transparent px-3 py-3 leading-5 whitespace-pre text-fg outline-none',
            )}
          />
        ) : (
          <pre className="selectable flex-1 px-3 py-3 whitespace-pre text-fg">{text}</pre>
        )}
      </div>
    </div>
  )
}
