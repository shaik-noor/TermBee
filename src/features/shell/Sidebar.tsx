import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { HexAvatar } from '@/components/brand/hex'
import { Button } from '@/components/ui/button'
import {
  ContextContent,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  ContextTrigger,
  Tooltip,
} from '@/components/ui/menu'
import { HostContextItems } from '@/features/hosts/HostMenu'
import {
  address,
  buildTree,
  connectHost,
  type FolderNode,
  folderName,
  folderParent,
  folderTitle,
  groupHosts,
  matchesQuery,
  useLiveCounts,
} from '@/features/hosts/lib'
import { cn } from '@/lib/cn'
import type { Host } from '@/lib/ipc'
import { useHosts } from '@/stores/hosts'
import { usePrefs } from '@/stores/prefs'
import { useUi } from '@/stores/ui'
import { type DragItem, type DropTarget, useTreeDrag } from './useTreeDrag'

/** Inline name editing: renaming a folder, or creating one inside `parent`. */
type Editing = { kind: 'rename'; path: string } | { kind: 'create'; parent: string | null } | null

export function Sidebar({ className }: { className?: string }) {
  const hosts = useHosts((s) => s.hosts)
  const folders = useHosts((s) => s.folders)
  const { moveHosts, moveFolder, createFolder, removeFolder } = useHosts.getState()
  const editHost = useUi((s) => s.editHost)
  const collapsedList = usePrefs((s) => s.collapsedFolders)
  const setPrefs = usePrefs((s) => s.set)
  const live = useLiveCounts()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList])
  const setCollapsed = (path: string, value: boolean) => {
    const next = new Set(usePrefs.getState().collapsedFolders)
    if (value) next.add(path)
    else next.delete(path)
    setPrefs({ collapsedFolders: [...next] })
  }

  const tree = useMemo(() => buildTree(folders, hosts), [folders, hosts])
  const filtered = useMemo(
    () => (query ? hosts.filter((h) => matchesQuery(h, query)) : hosts),
    [hosts, query],
  )
  const favorites = filtered.filter((h) => h.favorite)

  const drop = (dragged: DragItem, t: DropTarget) => {
    if (dragged.type === 'host') {
      void moveHosts([dragged.id], t.folder, t.before).catch(() => {})
      if (t.folder) setCollapsed(t.folder, false)
      return
    }
    if (folderParent(dragged.path) === t.folder) return
    const to = t.folder ? `${t.folder}/${folderName(dragged.path)}` : folderName(dragged.path)
    void moveFolder(dragged.path, to).catch(() => {})
  }
  const drag = useTreeDrag(scroller, drop)

  // Hovering a closed folder while dragging opens it after a moment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setCollapsed reads fresh prefs.
  useEffect(() => {
    const t = drag.target
    if (!drag.item || t?.position !== 'into' || !t.folder || !collapsed.has(t.folder)) return
    const folder = t.folder
    const timer = setTimeout(() => setCollapsed(folder, false), 650)
    return () => clearTimeout(timer)
  }, [drag.item, drag.target, collapsed])

  const commitName = async (name: string) => {
    const e = editing
    setEditing(null)
    const clean = name.trim()
    if (!e || !clean) return
    if (clean.includes('/')) {
      toast.error('Folder names can’t contain “/”', {
        description: 'Create the folder, then add a subfolder inside it.',
      })
      return
    }
    try {
      if (e.kind === 'create') {
        const path = e.parent ? `${e.parent}/${clean}` : clean
        await createFolder(path)
        if (e.parent) setCollapsed(e.parent, false)
      } else {
        const parent = folderParent(e.path)
        await moveFolder(e.path, parent ? `${parent}/${clean}` : clean)
      }
    } catch {
      // The store already showed why.
    }
  }

  const deleteFolder = (node: FolderNode) => {
    const parent = folderParent(node.path)
    void removeFolder(node.path)
      .then(() =>
        toast(`Deleted folder “${node.name}”`, {
          description: node.count
            ? `Its ${node.count === 1 ? 'host' : `${node.count} hosts`} moved to ${parent ? folderTitle(parent) : 'the top level'}.`
            : undefined,
        }),
      )
      .catch(() => {})
  }

  const ctx: TreeCtx = {
    live,
    collapsed,
    editing,
    drag,
    toggle: (path) => setCollapsed(path, !collapsed.has(path)),
    setEditing,
    commitName: (v) => void commitName(v),
    newHostIn: (path) => editHost('new', { group: path }),
    deleteFolder,
  }

  return (
    <aside
      className={cn('flex w-60 shrink-0 flex-col border-r border-line bg-surface/60', className)}
    >
      <div className="flex items-center gap-1 p-2.5 pb-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Filter hosts"
            spellCheck={false}
            className="h-8 w-full rounded-lg border border-line bg-bg/60 pr-2 pl-8 text-[13px] outline-none transition-colors placeholder:text-subtle focus:border-honey/50"
          />
        </div>
        <Tooltip label="New folder">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New folder"
            onClick={() => {
              setQuery('')
              setEditing({ kind: 'create', parent: null })
            }}
          >
            <FolderPlus />
          </Button>
        </Tooltip>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {favorites.length > 0 && (
          <section className="mt-1.5">
            <div className="flex h-7 items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
              <Star className="size-3 text-honey" fill="currentColor" /> Favorites
            </div>
            <div className="space-y-px">
              {favorites.map((h) => (
                <HostRow key={`fav-${h.id}`} host={h} live={live[h.id] ?? 0} />
              ))}
            </div>
          </section>
        )}

        {query ? (
          // Searching: a flat list grouped by folder path (no reordering while filtered).
          groupHosts(filtered).map(([group, list]) => (
            <section key={group} className="mt-1.5">
              <div className="flex h-7 items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                <Folder className="size-3" />
                <span className="truncate">{folderTitle(group)}</span>
              </div>
              {list.map((h) => (
                <HostRow key={h.id} host={h} live={live[h.id] ?? 0} />
              ))}
            </section>
          ))
        ) : (
          // The tree. Dropping on empty space below it moves things to the top level.
          <div data-drop-folder="" className="mt-1.5 min-h-[calc(100%-8px)] pb-6">
            {editing?.kind === 'create' && editing.parent === null && (
              <NameRow
                depth={0}
                initial="New folder"
                onDone={ctx.commitName}
                onCancel={() => setEditing(null)}
              />
            )}
            <FolderChildren node={tree} depth={0} ctx={ctx} />
          </div>
        )}

        {hosts.length > 0 && query && filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-subtle">No hosts match “{query}”.</p>
        )}
        {hosts.length === 0 && folders.length === 0 && (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-subtle">
            Your saved hosts will live here. Add one, or make folders to sort them into.
          </p>
        )}
      </div>

      <div className="border-t border-line p-2.5">
        <Button variant="honey" className="w-full" onClick={() => editHost('new')}>
          <Plus /> New host
        </Button>
      </div>

      {drag.item &&
        createPortal(
          <div
            ref={drag.ghost}
            className="pointer-events-none fixed top-0 left-0 z-[60] flex items-center gap-2 rounded-lg border border-honey/50 bg-surface px-2.5 py-1.5 text-[13px] font-medium shadow-glow will-change-transform"
          >
            {drag.item.type === 'folder' ? (
              <Folder className="size-3.5 fill-honey/25 text-honey" />
            ) : (
              <span className="hex-clip size-2.5 bg-honey" />
            )}
            {drag.item.label}
            {drag.target && (
              <span className="text-[11px] font-normal text-subtle">
                → {drag.target.folder ? folderName(drag.target.folder) : 'Top level'}
              </span>
            )}
          </div>,
          document.body,
        )}
    </aside>
  )
}

interface TreeCtx {
  live: Record<string, number>
  collapsed: Set<string>
  editing: Editing
  drag: ReturnType<typeof useTreeDrag>
  toggle: (path: string) => void
  setEditing: (e: Editing) => void
  commitName: (name: string) => void
  newHostIn: (path: string) => void
  deleteFolder: (node: FolderNode) => void
}

function FolderChildren({ node, depth, ctx }: { node: FolderNode; depth: number; ctx: TreeCtx }) {
  return (
    <>
      {node.folders.map((f) => (
        <FolderBranch key={f.path} node={f} depth={depth} ctx={ctx} />
      ))}
      {node.hosts.map((h, i) => (
        <DraggableHost
          key={h.id}
          host={h}
          depth={depth}
          next={node.hosts[i + 1]?.id ?? ''}
          ctx={ctx}
        />
      ))}
    </>
  )
}

const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 })

function FolderBranch({ node, depth, ctx }: { node: FolderNode; depth: number; ctx: TreeCtx }) {
  const isCollapsed = ctx.collapsed.has(node.path)
  const t = ctx.drag.target
  const isTarget = t?.position === 'into' && t.row === `f:${node.path}`
  const dragging = ctx.drag.item?.type === 'folder' && ctx.drag.item.path === node.path
  const renaming = ctx.editing?.kind === 'rename' && ctx.editing.path === node.path
  const creatingHere = ctx.editing?.kind === 'create' && ctx.editing.parent === node.path
  const Icon = isCollapsed ? Folder : FolderOpen

  return (
    <section className={cn(dragging && 'opacity-40')}>
      <ContextMenu>
        <ContextTrigger asChild>
          <div
            data-drop-folder={node.path}
            onPointerDown={(e) =>
              !renaming && ctx.drag.start(e, { type: 'folder', path: node.path, label: node.name })
            }
            className={cn(
              'group flex h-8 items-center gap-1.5 rounded-md pr-2 text-[13px] font-medium text-muted transition-[background-color,box-shadow] duration-150 hover:bg-surface-3/60 hover:text-fg',
              isTarget && 'bg-honey-soft text-fg shadow-[inset_0_0_0_1.5px_var(--honey)]',
            )}
            style={indent(depth)}
          >
            {renaming ? (
              <NameInput
                initial={node.name}
                onDone={ctx.commitName}
                onCancel={() => ctx.setEditing(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => !ctx.drag.suppressClick.current && ctx.toggle(node.path)}
                onDoubleClick={() => ctx.setEditing({ kind: 'rename', path: node.path })}
                aria-expanded={!isCollapsed}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
              >
                <ChevronRight
                  className={cn(
                    'size-3 shrink-0 text-subtle transition-transform duration-200',
                    !isCollapsed && 'rotate-90',
                  )}
                />
                <Icon className="size-3.5 shrink-0 fill-honey/20 text-honey" />
                <span className="truncate">{node.name}</span>
                <span className="ml-auto text-[11px] font-normal text-subtle tabular-nums">
                  {node.count || ''}
                </span>
              </button>
            )}
          </div>
        </ContextTrigger>
        <ContextContent>
          <ContextItem onSelect={() => ctx.newHostIn(node.path)}>
            <Plus /> New host here…
          </ContextItem>
          <ContextItem onSelect={() => ctx.setEditing({ kind: 'create', parent: node.path })}>
            <FolderPlus /> New subfolder
          </ContextItem>
          <ContextItem onSelect={() => ctx.setEditing({ kind: 'rename', path: node.path })}>
            <Pencil /> Rename
          </ContextItem>
          <ContextSeparator />
          <ContextItem onSelect={() => ctx.deleteFolder(node)} danger>
            <Trash2 /> Delete folder
          </ContextItem>
        </ContextContent>
      </ContextMenu>

      {/* 0fr↔1fr grid rows animate the folder open and shut without measuring heights. */}
      <div
        inert={isCollapsed}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          isCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {creatingHere && (
            <NameRow
              depth={depth + 1}
              initial="New folder"
              onDone={ctx.commitName}
              onCancel={() => ctx.setEditing(null)}
            />
          )}
          <FolderChildren node={node} depth={depth + 1} ctx={ctx} />
        </div>
      </div>
    </section>
  )
}

function DraggableHost({
  host,
  depth,
  next,
  ctx,
}: {
  host: Host
  depth: number
  next: string
  ctx: TreeCtx
}) {
  const t = ctx.drag.target
  const marker = t && t.row === `h:${host.id}` && t.position !== 'into' ? t.position : null
  const dragging = ctx.drag.item?.type === 'host' && ctx.drag.item.id === host.id
  return (
    <div
      data-drop-host={host.id}
      data-folder={host.group ?? ''}
      data-next={next}
      onPointerDown={(e) =>
        ctx.drag.start(e, { type: 'host', id: host.id, label: host.label, folder: host.group })
      }
      className={cn(
        'relative',
        dragging && 'opacity-40',
        // Insertion line where the host will land.
        marker &&
          'before:absolute before:inset-x-2 before:z-[1] before:h-0.5 before:rounded-full before:bg-honey',
        marker === 'before' && 'before:-top-px',
        marker === 'after' && 'before:-bottom-px',
      )}
    >
      <HostRow
        host={host}
        live={ctx.live[host.id] ?? 0}
        depth={depth}
        blockClick={ctx.drag.suppressClick}
      />
    </div>
  )
}

const HostRow = memo(function HostRow({
  host,
  live,
  depth = 0,
  blockClick,
}: {
  host: Host
  live: number
  depth?: number
  blockClick?: React.RefObject<boolean>
}) {
  return (
    <ContextMenu>
      <ContextTrigger asChild>
        <button
          type="button"
          onClick={() => !blockClick?.current && connectHost(host)}
          title={`Connect to ${address(host)}`}
          className="group flex h-9 w-full items-center gap-2.5 rounded-lg pr-2 text-left transition-[background-color,translate,scale] duration-150 hover:bg-surface-3/70 active:scale-[0.98]"
          style={indent(depth)}
        >
          <HexAvatar
            label={host.label}
            color={host.color}
            icon={host.icon}
            protocol={host.protocol}
            size={22}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] leading-tight font-medium">{host.label}</div>
            <div className="truncate font-mono text-[10.5px] leading-tight text-subtle">
              {address(host)}
            </div>
          </div>
          {live > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-clover/15 px-1.5 py-0.5 text-[10px] font-semibold text-clover">
              <span className="hex-clip size-1.5 bg-clover" />
              {live}
            </span>
          )}
        </button>
      </ContextTrigger>
      <ContextContent>
        <HostContextItems host={host} />
      </ContextContent>
    </ContextMenu>
  )
})

function NameRow({
  depth,
  initial,
  onDone,
  onCancel,
}: {
  depth: number
  initial: string
  onDone: (v: string) => void
  onCancel: () => void
}) {
  return (
    <div className="flex h-8 items-center gap-1.5 pr-2 animate-fade-in" style={indent(depth)}>
      <span className="size-3" />
      <FolderPlus className="size-3.5 shrink-0 text-honey" />
      <NameInput initial={initial} onDone={onDone} onCancel={onCancel} />
    </div>
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
    ref.current?.focus()
    ref.current?.select()
  }, [])
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
      aria-label="Folder name"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-6 min-w-0 flex-1 rounded border border-honey/60 bg-surface px-1.5 text-[13px] text-fg outline-none"
    />
  )
}
