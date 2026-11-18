import { getCurrentWindow } from '@tauri-apps/api/window'
import { CopyPlus, Hexagon, PanelLeft, Plus, RotateCw, Search, Settings2, X } from 'lucide-react'
import { motion } from 'motion/react'
import { BeeMark } from '@/components/brand/BeeMark'
import { HOST_COLORS, StatusHex } from '@/components/brand/hex'
import { PROTOCOLS } from '@/components/brand/icons'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/input'
import {
  ContextContent,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  ContextTrigger,
  Tooltip,
} from '@/components/ui/menu'
import { cn } from '@/lib/cn'
import { isMac, isTauri } from '@/lib/platform'
import { label as shortcut } from '@/lib/shortcuts'
import { usePrefs } from '@/stores/prefs'
import { HOME, type Tab, useSessions } from '@/stores/sessions'
import { useUi } from '@/stores/ui'

/**
 * The app toolbar: brand, tabs, quick-search trigger, and settings. Window controls are
 * always supplied by the operating system.
 */
export function TitleBar() {
  const tabs = useSessions((s) => s.tabs)
  const activeId = useSessions((s) => s.activeId)
  const activate = useSessions((s) => s.activate)
  const setPalette = useUi((s) => s.setPalette)
  const setSettings = useUi((s) => s.setSettings)
  const sidebarOpen = usePrefs((s) => s.sidebarOpen)
  const setPrefs = usePrefs((s) => s.set)

  const onHeaderDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!isMac || !isTauri) return
    if ((e.target as HTMLElement).closest('button, input, a, [role="tab"]')) return
    void getCurrentWindow().toggleMaximize()
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: double-clicking empty titlebar space toggles maximize
    <header
      data-tauri-drag-region={isMac ? true : undefined}
      onDoubleClick={onHeaderDoubleClick}
      className="relative z-20 flex h-11 shrink-0 items-stretch border-b border-line bg-surface/60 backdrop-blur-md select-none"
    >
      {/* Left brand cell: clears the native macOS traffic lights and aligns with the sidebar. */}
      <div
        data-tauri-drag-region={isMac ? true : undefined}
        className={cn(
          'flex shrink-0 items-center gap-2.5 border-r border-line px-3 transition-[width] duration-200',
          sidebarOpen ? 'w-60' : 'w-auto',
          isMac && 'pl-[84px]',
        )}
      >
        <div
          data-tauri-drag-region={isMac ? true : undefined}
          className="flex items-center gap-1.5"
        >
          <BeeMark className="pointer-events-none h-5 shrink-0" />
          <span
            data-tauri-drag-region={isMac ? true : undefined}
            className="font-display text-[13px] font-bold tracking-tight text-fg"
          >
            Term<span className="text-honey">Bee</span>
          </span>
        </div>
        <Tooltip label={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (${shortcut('sidebar')})`}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={sidebarOpen}
            onClick={() => setPrefs({ sidebarOpen: !sidebarOpen })}
            className={cn('ml-auto', sidebarOpen && 'bg-surface-2 text-fg')}
          >
            <PanelLeft />
          </Button>
        </Tooltip>
      </div>

      {/* Tabs */}
      <div
        data-tauri-drag-region={isMac ? true : undefined}
        aria-label="Tabs"
        role="tablist"
        className="flex min-w-0 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none]"
      >
        <TabButton active={activeId === HOME} onClick={() => activate(HOME)} label="Hive">
          <Hexagon className="size-3.5 text-honey" strokeWidth={2.4} />
          <span>Hive</span>
        </TabButton>
        {tabs.map((t) => (
          <SessionTab key={t.id} tab={t} active={activeId === t.id} />
        ))}
        <Tooltip label={`Connect to a host (${shortcut('newTab')})`}>
          <button
            type="button"
            aria-label="New tab"
            onClick={() => setPalette(true)}
            className="ml-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-transparent text-muted transition-colors hover:border-line hover:bg-surface-2 hover:text-fg"
          >
            <Plus className="size-3.5" />
          </button>
        </Tooltip>
      </div>

      <div data-tauri-drag-region={isMac ? true : undefined} className="min-w-4 flex-1" />

      {/* Right cluster */}
      <div
        data-tauri-drag-region={isMac ? true : undefined}
        className="flex items-center gap-1.5 pr-2.5"
      >
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-7 w-56 items-center gap-2 rounded-lg border border-line bg-bg/70 px-2.5 text-xs text-subtle transition-colors hover:border-honey/40 hover:bg-surface hover:text-muted max-lg:w-36"
        >
          <Search className="size-3.5 text-honey/80" />
          <span className="truncate">Find or connect…</span>
          <Kbd className="ml-auto max-lg:hidden">{shortcut('palette')}</Kbd>
        </button>
        <Tooltip label={`Settings (${shortcut('settings')})`}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            className="group/settings"
            onClick={() => setSettings(true)}
          >
            <Settings2 className="transition-transform duration-300 group-hover/settings:rotate-45" />
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}

function TabButton({
  active,
  onClick,
  label,
  children,
  trailing,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
  /** Rendered beside (not inside) the tab button, e.g. a close button. */
  trailing?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'group relative flex h-7 max-w-52 min-w-0 shrink-0 items-center rounded-lg border text-[12.5px] font-medium transition-colors duration-150',
        active
          ? 'border-line-strong bg-bg text-fg shadow-2xs'
          : 'border-transparent text-muted hover:border-line/60 hover:bg-surface-2/70 hover:text-fg',
      )}
    >
      {active && (
        <motion.span
          layoutId="tab-active"
          className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-honey"
          transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        />
      )}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={label}
        onClick={onClick}
        className={cn(
          'flex h-full min-w-0 items-center gap-1.5 pl-2.5',
          trailing ? 'pr-1' : 'pr-2.5',
        )}
      >
        {children}
      </button>
      {trailing && <div className="pr-1">{trailing}</div>}
    </div>
  )
}

function SessionTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { activate, close, reconnect, duplicate } = useSessions.getState()
  const color = HOST_COLORS[tab.target.color]?.fill
  const KindIcon = PROTOCOLS[tab.kind === 'files' ? 'sftp' : 'ssh'].Icon
  return (
    <ContextMenu>
      <ContextTrigger asChild>
        <div
          className="flex min-w-0 shrink-0 animate-tab-in"
          onAuxClick={(e) => e.button === 1 && close(tab.id)}
        >
          <TabButton
            active={active}
            onClick={() => activate(tab.id)}
            label={tab.target.label}
            trailing={
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Close ${tab.target.label}`}
                onClick={() => close(tab.id)}
                className={cn(
                  'grid size-4.5 place-items-center rounded text-subtle hover:bg-surface-3 hover:text-fg',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <X className="size-3" />
              </button>
            }
          >
            <KindIcon className="size-3.5 shrink-0" style={{ color }} strokeWidth={2.2} />
            <span className="truncate">{tab.target.label}</span>
            <StatusHex status={tab.status} className="size-2" />
          </TabButton>
        </div>
      </ContextTrigger>
      <ContextContent>
        <ContextItem onSelect={() => reconnect(tab.id)}>
          <RotateCw /> Reconnect
        </ContextItem>
        <ContextItem onSelect={() => duplicate(tab.id)}>
          <CopyPlus /> Duplicate tab
        </ContextItem>
        <ContextSeparator />
        <ContextItem onSelect={() => close(tab.id)} danger>
          <X /> Close tab
        </ContextItem>
      </ContextContent>
    </ContextMenu>
  )
}
