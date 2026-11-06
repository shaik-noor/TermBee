import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  HardDrive,
  House,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  Monitor,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Server,
  Trash2,
  Upload,
} from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ContextContent,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  ContextTrigger,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Tooltip,
} from '@/components/ui/menu'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import type { FileEntry, Place } from '@/lib/ipc'
import { isMac } from '@/lib/platform'
import { type FilesSortKey, usePrefs } from '@/stores/prefs'
import { entryIcon, formatDate, formatSize, typeLabel } from './format'
import { crumbs } from './source'
import type { FileDragApi } from './useFileDrag'
import type { Pane } from './usePane'

export interface PaneActions {
  open: (e: FileEntry) => void
  preview: (e: FileEntry) => void
  /** Send to the other pane (upload or download). */
  transfer: (entries: FileEntry[]) => void
  copy: (entries: FileEntry[], cut: boolean) => void
  paste: () => void
  canPaste: boolean
  remove: (entries: FileEntry[]) => void
  rename: (e: FileEntry, name: string) => void
  mkdir: (name: string) => void
  /** This PC only. */
  openWithApp?: (e: FileEntry) => void
  reveal?: (e: FileEntry) => void
}

const mod = isMac ? '⌘' : 'Ctrl+'
const PLACE_ICON = {
  home: House,
  desktop: Monitor,
  documents: FolderOpen,
  downloads: Download,
  drive: HardDrive,
}

/** One side of a files tab. Rendered twice: This PC and the server. */
export function FilePane({
  pane,
  title,
  places,
  focused,
  onFocus,
  drag,
  actions,
  otherLabel,
}: {
  pane: Pane
  title: string
  places: Place[]
  focused: boolean
  onFocus: () => void
  drag: FileDragApi
  actions: PaneActions
  otherLabel: string
}) {
  const source = pane.source
  const view = usePrefs((s) => s.filesView)
  const showHidden = usePrefs((s) => s.filesShowHidden)
  const sort = usePrefs((s) => s.filesSort)
  const setPrefs = usePrefs((s) => s.set)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingPath, setEditingPath] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  if (!source) return <div className="flex-1" />
  const side = source.side
  const sel = pane.selection
  const isRemote = side === 'remote'
  const SideIcon = isRemote ? Server : Monitor
  const dropHere = drag.target?.side === side && drag.target.dir === pane.cwd && drag.drag
  const selectedBytes = sel.reduce((s, e) => s + (e.kind === 'dir' ? 0 : e.size), 0)

  const setSort = (key: FilesSortKey) =>
    setPrefs({ filesSort: { key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 } })

  const focusBody = () => body.current?.focus()

  const moveCursor = (delta: number) => {
    const rows = pane.visible
    if (rows.length === 0) return
    const last = rows.findIndex((r) => r.path === sel.at(-1)?.path)
    const next = Math.min(rows.length - 1, Math.max(0, last < 0 ? 0 : last + delta))
    pane.selectOnly(rows[next].path)
    body.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || creating || editingPath) return
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key
    const gridStep = view === 'grid' ? columnsInGrid(body.current) : 1
    const run = (fn: () => unknown) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    if (k === 'ArrowDown') run(() => moveCursor(gridStep))
    else if (k === 'ArrowUp' && e.altKey) run(() => pane.up())
    else if (k === 'ArrowUp') run(() => moveCursor(-gridStep))
    else if (k === 'ArrowLeft' && e.altKey) run(() => void pane.back())
    else if (k === 'ArrowRight' && e.altKey) run(() => void pane.forward())
    else if (k === 'ArrowRight' && view === 'grid') run(() => moveCursor(1))
    else if (k === 'ArrowLeft' && view === 'grid') run(() => moveCursor(-1))
    else if (k === 'Home') run(() => moveCursor(-1e9))
    else if (k === 'End') run(() => moveCursor(1e9))
    else if (k === 'Enter' && sel.length === 1) run(() => actions.open(sel[0]))
    else if (k === ' ' && sel.length === 1) run(() => actions.preview(sel[0]))
    else if (k === 'Backspace') run(() => pane.up())
    else if (k === 'Delete' && sel.length) run(() => actions.remove(sel))
    else if (k === 'F2' && sel.length === 1) run(() => setRenaming(sel[0].path))
    else if (k === 'F5' && sel.length) run(() => actions.transfer(sel))
    else if (k === 'F7') run(() => setCreating(true))
    else if (k === 'Escape') run(() => pane.selectOnly(null))
    else if (ctrl && k.toLowerCase() === 'a')
      run(() => pane.setSelected(new Set(pane.visible.map((r) => r.path))))
    else if (ctrl && k.toLowerCase() === 'c' && sel.length) run(() => actions.copy(sel, false))
    else if (ctrl && k.toLowerCase() === 'x' && sel.length) run(() => actions.copy(sel, true))
    else if (ctrl && k.toLowerCase() === 'v') run(() => actions.paste())
    else if (ctrl && k.toLowerCase() === 'l') run(() => setEditingPath(true))
    else if (ctrl && k.toLowerCase() === 'f') run(() => filterRef.current?.focus())
    else if (ctrl && k.toLowerCase() === 'h') run(() => setPrefs({ filesShowHidden: !showHidden }))
  }

  const startDrag = (e: React.PointerEvent, entry: FileEntry) => {
    if (renaming) return
    const inSelection = pane.selected.has(entry.path)
    drag.start(e, { side, entries: inSelection ? sel : [entry] })
  }

  return (
    <section
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      className={cn(
        '@container relative flex min-w-0 flex-1 flex-col bg-bg transition-[box-shadow] duration-150',
        focused && 'shadow-[inset_0_2px_0_var(--honey)]',
      )}
    >
      {/* Header: place menu, history, path */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-surface/60 px-1.5">
        <DropdownMenu>
          <DropdownTrigger asChild>
            <button
              type="button"
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-fg transition-colors hover:bg-surface-3"
            >
              <SideIcon className={cn('size-3.5', isRemote ? 'text-clover' : 'text-sky')} />
              <span className="max-w-28 truncate">{title}</span>
              <ChevronDown className="size-3 text-subtle" />
            </button>
          </DropdownTrigger>
          <DropdownContent align="start">
            {places.map((p) => {
              const Icon = PLACE_ICON[p.kind] ?? FolderOpen
              return (
                <DropdownItem key={p.path} onSelect={() => void pane.go(p.path)}>
                  <Icon /> {p.label}
                  <span className="ml-auto max-w-40 truncate pl-4 font-mono text-[11px] text-subtle">
                    {p.path}
                  </span>
                </DropdownItem>
              )
            })}
          </DropdownContent>
        </DropdownMenu>
        <NavBtn label="Back (Alt+←)" onClick={() => void pane.back()} disabled={!pane.canBack}>
          <ArrowLeft />
        </NavBtn>
        <NavBtn
          label="Forward (Alt+→)"
          onClick={() => void pane.forward()}
          disabled={!pane.canForward}
        >
          <ArrowRight />
        </NavBtn>
        <NavBtn label="Up a folder (Backspace)" onClick={pane.up} disabled={!pane.cwd}>
          <ArrowUp />
        </NavBtn>

        {editingPath ? (
          <PathInput
            initial={pane.cwd ?? ''}
            onDone={(p) => {
              setEditingPath(false)
              if (p && p !== pane.cwd) void pane.go(p).then(focusBody)
              else focusBody()
            }}
          />
        ) : (
          // biome-ignore lint/a11y/useKeyWithClickEvents: Ctrl+L edits the path from the keyboard
          <nav
            aria-label="Path"
            onClick={(e) => e.target === e.currentTarget && setEditingPath(true)}
            className="flex h-7 min-w-0 flex-1 cursor-text items-center overflow-x-auto rounded-md px-1 [scrollbar-width:none] hover:bg-surface-2"
            title={`${pane.cwd ?? ''} (click or ${mod}L to type a path)`}
          >
            {pane.cwd &&
              crumbs(source.sep, pane.cwd).map(([name, path], i, all) => (
                <span key={path} className="flex shrink-0 items-center">
                  {i > 0 && (source.sep === '\\' || i > 1) && (
                    <ChevronRight className="size-3 text-subtle" />
                  )}
                  <button
                    type="button"
                    data-drop-side={side}
                    data-drop-dir={path}
                    onClick={() => void pane.go(path)}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-surface-3',
                      i === all.length - 1 ? 'text-fg' : 'text-muted',
                      drag.target?.side === side &&
                        drag.target.dir === path &&
                        drag.drag &&
                        'bg-honey-soft text-fg',
                    )}
                  >
                    {name}
                  </button>
                </span>
              ))}
          </nav>
        )}

        <NavBtn label="Refresh" onClick={() => void pane.refresh()} disabled={!pane.cwd}>
          <RefreshCw className={cn(pane.loading && 'animate-spin')} />
        </NavBtn>
        <Tooltip label={`${isRemote ? 'Download to' : 'Upload to'} ${otherLabel} (F5)`}>
          <button
            type="button"
            disabled={sel.length === 0}
            onClick={() => actions.transfer(sel)}
            className="ml-0.5 flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-honey px-2 text-xs font-semibold text-honey-fg transition-[opacity,scale,background-color] duration-150 hover:bg-honey-strong active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5"
          >
            {isRemote ? <Download /> : <Upload />}
            <span className="max-[1100px]:hidden">{isRemote ? 'Download' : 'Upload'}</span>
          </button>
        </Tooltip>
      </div>

      {/* Listing */}
      <ContextMenu>
        <ContextTrigger asChild>
          <div
            ref={body}
            role="grid"
            tabIndex={0}
            aria-label={`${title} files`}
            aria-multiselectable
            data-drop-side={side}
            data-drop-dir={pane.cwd ?? ''}
            onKeyDown={onKeyDown}
            onClick={(e) => e.target === e.currentTarget && pane.selectOnly(null)}
            onContextMenu={(e) => e.target === e.currentTarget && pane.selectOnly(null)}
            className={cn(
              'relative min-h-0 flex-1 overflow-y-auto outline-none',
              view === 'grid' &&
                'grid auto-rows-max grid-cols-[repeat(auto-fill,minmax(92px,1fr))] content-start gap-1 p-2',
            )}
          >
            {view === 'list' && columnHeader(isRemote)}
            {creating && (
              <div className={cn(view === 'list' ? 'px-3 py-1' : 'col-span-full px-1')}>
                <NameInput
                  initial="New folder"
                  onDone={(v) => {
                    setCreating(false)
                    if (v.trim()) actions.mkdir(v.trim())
                    focusBody()
                  }}
                  onCancel={() => {
                    setCreating(false)
                    focusBody()
                  }}
                />
              </div>
            )}
            {pane.visible.map((e, i) => (
              <Item
                key={e.path}
                entry={e}
                index={i}
                view={view}
                remote={isRemote}
                selected={pane.selected.has(e.path)}
                renaming={renaming === e.path}
                dimmed={!!drag.drag?.entries.some((d) => d.path === e.path)}
                dropTarget={
                  e.kind === 'dir' && drag.target?.side === side && drag.target.dir === e.path
                }
                onPointerDown={(ev) => {
                  if (!pane.selected.has(e.path) && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey)
                    pane.selectOnly(e.path)
                  startDrag(ev, e)
                }}
                onClick={(ev) => !drag.suppressClick.current && pane.click(ev, i)}
                onOpen={() => actions.open(e)}
                onContext={() => !pane.selected.has(e.path) && pane.selectOnly(e.path)}
                onRename={(v) => {
                  setRenaming(null)
                  if (v.trim() && v.trim() !== e.name) actions.rename(e, v.trim())
                  focusBody()
                }}
                onCancelRename={() => {
                  setRenaming(null)
                  focusBody()
                }}
              />
            ))}
            {pane.cwd && pane.visible.length === 0 && !creating && !pane.loading && (
              <div className="col-span-full grid place-items-center py-14 text-center text-sm text-subtle">
                <FolderOpen className="mb-2 size-6" />
                {pane.filter
                  ? `Nothing here matches “${pane.filter}”.`
                  : pane.entries.length
                    ? 'Only hidden files here.'
                    : isRemote
                      ? 'This folder is empty. Drop files here to upload them.'
                      : 'This folder is empty.'}
              </div>
            )}
            {!pane.cwd && pane.loading && <Skeleton />}
            {pane.error && (
              <div className="col-span-full m-3 flex items-start gap-2 rounded-xl border border-rose/30 bg-rose/8 p-3 text-sm text-rose">
                <span className="flex-1">{pane.error}</span>
                <button
                  type="button"
                  onClick={() => void pane.refresh()}
                  className="text-xs underline-offset-2 hover:underline"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </ContextTrigger>
        <ContextContent>
          {sel.length > 0 ? (
            <>
              {sel.length === 1 && (
                <ContextItem onSelect={() => actions.open(sel[0])}>
                  <FolderOpen /> {sel[0].kind === 'dir' ? 'Open' : isRemote ? 'Preview' : 'Open'}
                </ContextItem>
              )}
              {sel.length === 1 && sel[0].kind !== 'dir' && (
                <ContextItem onSelect={() => actions.preview(sel[0])}>
                  <Eye /> Quick look <Hint>Space</Hint>
                </ContextItem>
              )}
              {sel.length === 1 && actions.openWithApp && (
                <ContextItem onSelect={() => actions.openWithApp?.(sel[0])}>
                  <ExternalLink /> Open with default app
                </ContextItem>
              )}
              {sel.length === 1 && actions.reveal && (
                <ContextItem onSelect={() => actions.reveal?.(sel[0])}>
                  <FolderSearch /> Show in {isMac ? 'Finder' : 'Explorer'}
                </ContextItem>
              )}
              <ContextItem onSelect={() => actions.transfer(sel)}>
                {isRemote ? <Download /> : <Upload />}
                {isRemote ? 'Download' : 'Upload'} to {otherLabel} <Hint>F5</Hint>
              </ContextItem>
              <ContextSeparator />
              <ContextItem onSelect={() => actions.copy(sel, false)}>
                <Copy /> Copy <Hint>{mod}C</Hint>
              </ContextItem>
              <ContextItem onSelect={() => actions.copy(sel, true)}>
                <Scissors /> Cut <Hint>{mod}X</Hint>
              </ContextItem>
              {actions.canPaste && (
                <ContextItem onSelect={actions.paste}>
                  <ClipboardPaste /> Paste here <Hint>{mod}V</Hint>
                </ContextItem>
              )}
              {sel.length === 1 && (
                <ContextItem onSelect={() => setRenaming(sel[0].path)}>
                  <Pencil /> Rename <Hint>F2</Hint>
                </ContextItem>
              )}
              {sel.length === 1 && (
                <ContextItem
                  onSelect={() =>
                    void copyText(sel[0].path).then(() =>
                      toast.success('Path copied', { duration: 1200 }),
                    )
                  }
                >
                  <Link2 /> Copy path
                </ContextItem>
              )}
              <ContextSeparator />
              <ContextItem onSelect={() => actions.remove(sel)} danger>
                <Trash2 /> {isRemote ? 'Delete' : `Move to ${isMac ? 'Trash' : 'Recycle Bin'}`}
                <Hint>Del</Hint>
              </ContextItem>
            </>
          ) : (
            <>
              <ContextItem onSelect={() => setCreating(true)}>
                <FolderPlus /> New folder <Hint>F7</Hint>
              </ContextItem>
              {actions.canPaste && (
                <ContextItem onSelect={actions.paste}>
                  <ClipboardPaste /> Paste <Hint>{mod}V</Hint>
                </ContextItem>
              )}
              <ContextItem onSelect={() => void pane.refresh()}>
                <RefreshCw /> Refresh
              </ContextItem>
              <ContextItem onSelect={() => setPrefs({ filesShowHidden: !showHidden })}>
                {showHidden ? <EyeOff /> : <Eye />} {showHidden ? 'Hide' : 'Show'} hidden files
              </ContextItem>
            </>
          )}
        </ContextContent>
      </ContextMenu>

      {dropHere && (
        <div className="pointer-events-none absolute inset-x-1.5 top-11 bottom-9 z-[2] rounded-xl border-2 border-dashed border-honey/60 bg-honey-soft/40 animate-fade-in" />
      )}

      {/* Footer: counts, filter, view options */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line bg-surface/60 px-3 text-[11px] text-subtle">
        <span className="truncate tabular-nums">
          {sel.length
            ? `${sel.length} of ${pane.visible.length} selected${selectedBytes ? ` · ${formatSize(selectedBytes)}` : ''}`
            : `${pane.visible.length} ${pane.visible.length === 1 ? 'item' : 'items'}`}
        </span>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2" />
          <input
            ref={filterRef}
            value={pane.filter}
            onChange={(e) => pane.setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                pane.setFilter('')
                focusBody()
              }
              if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault()
                focusBody()
                if (pane.visible[0]) pane.selectOnly(pane.visible[0].path)
              }
            }}
            placeholder="Filter"
            spellCheck={false}
            aria-label="Filter files"
            className="h-6 w-28 rounded-md border border-line bg-bg/60 pr-1.5 pl-5 text-[11px] text-fg outline-none transition-[width,border-color] duration-200 placeholder:text-subtle focus:w-40 focus:border-honey/50"
          />
        </div>
        <FooterBtn
          label={`${showHidden ? 'Hide' : 'Show'} hidden files (${mod}H)`}
          on={showHidden}
          onClick={() => setPrefs({ filesShowHidden: !showHidden })}
        >
          {showHidden ? <Eye /> : <EyeOff />}
        </FooterBtn>
        <FooterBtn
          label={view === 'list' ? 'Icon view' : 'List view'}
          on={false}
          onClick={() => setPrefs({ filesView: view === 'list' ? 'grid' : 'list' })}
        >
          {view === 'list' ? <LayoutGrid /> : <List />}
        </FooterBtn>
        {view === 'grid' && (
          <DropdownMenu>
            <DropdownTrigger asChild>
              <button
                type="button"
                aria-label="Sort"
                className="grid size-6 place-items-center rounded text-subtle hover:bg-surface-3 hover:text-fg [&_svg]:size-3.5"
              >
                <ArrowUpDown />
              </button>
            </DropdownTrigger>
            <DropdownContent>
              {(['name', 'size', 'modified', 'type'] as const).map((k) => (
                <DropdownItem key={k} onSelect={() => setSort(k)}>
                  {sort.key === k ? (
                    sort.dir === 1 ? (
                      <ArrowUp />
                    ) : (
                      <ArrowDown />
                    )
                  ) : (
                    <span className="size-4" />
                  )}
                  Sort by {k}
                </DropdownItem>
              ))}
            </DropdownContent>
          </DropdownMenu>
        )}
        <FooterBtn label="New folder (F7)" on={false} onClick={() => setCreating(true)}>
          <FolderPlus />
        </FooterBtn>
      </div>
    </section>
  )

  function columnHeader(remote: boolean) {
    const col = (key: FilesSortKey, label: string, cls?: string) => (
      <button
        type="button"
        onClick={() => setSort(key)}
        className={cn(
          'flex items-center gap-1 truncate text-left uppercase hover:text-fg',
          sort.key === key && 'text-muted',
          cls,
        )}
      >
        {label}
        {sort.key === key &&
          (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    )
    return (
      <div
        className={cn(
          ROW_GRID,
          'sticky top-0 z-[1] h-7 border-b border-line bg-bg/95 text-[10.5px] font-semibold tracking-wider text-subtle',
        )}
      >
        {col('name', 'Name')}
        {col('size', 'Size', 'justify-end')}
        {col('modified', 'Modified', 'hidden @[30rem]:flex')}
        {col('type', 'Type', 'hidden @[44rem]:flex')}
        {remote ? (
          <span className="hidden truncate uppercase @[38rem]:block">Permissions</span>
        ) : (
          <span className="hidden @[38rem]:block" />
        )}
      </div>
    )
  }
}

/** Name | Size | Modified (≥30rem) | Type (≥44rem) | Permissions (≥38rem). */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3 px-3 @[30rem]:grid-cols-[minmax(0,1fr)_72px_136px] @[38rem]:grid-cols-[minmax(0,1fr)_72px_136px_88px] @[44rem]:grid-cols-[minmax(0,1fr)_72px_136px_80px_88px]'

const Item = memo(function Item({
  entry: e,
  index,
  view,
  remote,
  selected,
  renaming,
  dimmed,
  dropTarget,
  onPointerDown,
  onClick,
  onOpen,
  onContext,
  onRename,
  onCancelRename,
}: {
  entry: FileEntry
  index: number
  view: 'list' | 'grid'
  remote: boolean
  selected: boolean
  renaming: boolean
  dimmed: boolean
  dropTarget: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
  onOpen: () => void
  onContext: () => void
  onRename: (v: string) => void
  onCancelRename: () => void
}) {
  const Icon = entryIcon(e)
  const dir = e.kind === 'dir'
  const iconCls = cn(dir ? 'fill-honey/25 text-honey' : 'text-muted')
  const common = {
    role: 'row',
    'aria-selected': selected,
    'data-index': index,
    ...(dir ? { 'data-drop-side': remote ? 'remote' : 'local', 'data-drop-dir': e.path } : {}),
    onPointerDown,
    onClick,
    onDoubleClick: onOpen,
    onContextMenu: onContext,
  }
  const state = cn(
    selected ? 'bg-honey-soft' : 'hover:bg-surface-2',
    dropTarget && 'bg-honey-soft shadow-[inset_0_0_0_1.5px_var(--honey)]',
    dimmed && 'opacity-40',
    e.hidden && !selected && 'opacity-70',
  )
  const name = renaming ? (
    <NameInput initial={e.name} onDone={onRename} onCancel={onCancelRename} />
  ) : (
    <span
      className={cn(
        'truncate',
        view === 'grid' && 'line-clamp-2 text-center break-all whitespace-normal',
      )}
    >
      {e.name}
    </span>
  )

  if (view === 'grid')
    return (
      <div
        {...common}
        tabIndex={-1}
        title={e.name}
        className={cn(
          'flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-xs transition-colors',
          state,
        )}
      >
        <span className="relative">
          <Icon className={cn('size-9', iconCls)} strokeWidth={1.4} />
          {e.link && <Link2 className="absolute -right-1 -bottom-1 size-3 text-subtle" />}
        </span>
        {name}
      </div>
    )

  return (
    <div
      {...common}
      tabIndex={-1}
      className={cn(
        ROW_GRID,
        // Off-screen rows skip layout and paint: thousands of files stay smooth.
        'h-[30px] text-[13px] [contain-intrinsic-size:auto_30px] [content-visibility:auto]',
        state,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={cn('size-4 shrink-0', iconCls)} />
        {name}
        {e.link && <Link2 className="size-3 shrink-0 text-subtle" aria-label="Symbolic link" />}
      </span>
      <span className="text-right font-mono text-[11px] text-subtle tabular-nums">
        {dir ? '' : formatSize(e.size)}
      </span>
      <span className="hidden truncate text-xs text-subtle @[30rem]:block">
        {formatDate(e.modified)}
      </span>
      <span className="hidden truncate text-xs text-subtle @[44rem]:block">{typeLabel(e)}</span>
      <span className="hidden font-mono text-[11px] text-subtle @[38rem]:block">
        {e.permissions}
      </span>
    </div>
  )
})

function columnsInGrid(el: HTMLElement | null): number {
  if (!el) return 1
  const cols = getComputedStyle(el).gridTemplateColumns.split(' ').length
  return Math.max(1, cols)
}

function Skeleton() {
  return (
    <div className="col-span-full space-y-1.5 p-3">
      {[72, 55, 64, 40, 58].map((w) => (
        <div
          key={w}
          className="h-4 animate-pulse rounded bg-surface-2"
          style={{ width: `${w}%` }}
        />
      ))}
      <Loader2 className="sr-only" />
    </div>
  )
}

function NavBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5"
      >
        {children}
      </button>
    </Tooltip>
  )
}

function FooterBtn({
  label,
  on,
  onClick,
  children,
}: {
  label: string
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        onClick={onClick}
        className={cn(
          'grid size-6 place-items-center rounded transition-colors hover:bg-surface-3 hover:text-fg [&_svg]:size-3.5',
          on ? 'text-honey' : 'text-subtle',
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <span className="ml-auto pl-4 text-[11px] text-subtle">{children}</span>
)

function PathInput({ initial, onDone }: { initial: string; onDone: (p: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v?.trim() || null)
  }
  return (
    <input
      ref={ref}
      defaultValue={initial}
      spellCheck={false}
      aria-label="Path"
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(null)}
      className="h-7 min-w-0 flex-1 rounded-md border border-honey/60 bg-surface px-2 font-mono text-xs outline-none"
    />
  )
}

function NameInput({
  initial,
  onDone,
  onCancel,
}: {
  initial: string
  onDone: (v: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // Select the name without its extension, like Explorer and Finder.
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    if (v === null) onCancel()
    else onDone(v)
  }
  return (
    <input
      ref={ref}
      defaultValue={initial}
      spellCheck={false}
      aria-label="Name"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-6 w-full min-w-0 rounded border border-honey/60 bg-surface px-1.5 text-[13px] text-fg outline-none"
    />
  )
}
