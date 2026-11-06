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
import { isMac } from '@/lib/platform'
import { label as shortcut } from '@/lib/shortcuts'
import { usePrefs } from '@/stores/prefs'
import { HOME, type Tab, useSessions } from '@/stores/sessions'
import { useUi } from '@/stores/ui'
import { WindowControls } from './WindowControls'

/**
 * The window's top bar: brand, tabs, search, settings, and (Windows) caption buttons.
 * Empty areas carry `data-tauri-drag-region` so the window can be dragged/maximized.
 */
export function TitleBar() {
  const tabs = useSessions((s) => s.tabs)
  const activeId = useSessions((s) => s.activeId)
  const activate = useSessions((s) => s.activate)
  const setPalette = useUi((s) => s.setPalette)
  const setSettings = useUi((s) => s.setSettings)
  const sidebarOpen = usePrefs((s) => s.sidebarOpen)
  const setPrefs = usePrefs((s) => s.set)

  return (
    <header
      data-tauri-drag-region
      className="relative z-20 flex h-11 shrink-0 items-stretch border-b border-line bg-bg"
    >
      {/* Brand (leaves room for macOS traffic lights) */}
      <div
        data-tauri-drag-region
        className={cn('flex items-center gap-2 pr-3', isMac ? 'pl-[84px]' : 'pl-3.5')}
      >
        <BeeMark className="pointer-events-none h-5" />
        {!isMac && (
          <span
            data-tauri-drag-region
            className="font-display text-[13px] font-semibold tracking-tight"
          >
            Term<span className="text-honey">Bee</span>
          </span>
        )}
        <Tooltip label={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (${shortcut('sidebar')})`}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={sidebarOpen}
            onClick={() => setPrefs({ sidebarOpen: !sidebarOpen })}
            className="ml-1.5"
          >
            <PanelLeft />
          </Button>
        </Tooltip>
      </div>

      {/* Tabs */}
      <div
        aria-label="Tabs"
        role="tablist"
        className="flex min-w-0 items-end gap-0.5 overflow-x-auto pt-1.5 [scrollbar-width:none]"
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
            className="mb-1 ml-1 grid size-7 shrink-0 place-items-center self-center rounded-md text-muted hover:bg-surface-3 hover:text-fg"
          >
            <Plus className="size-4" />
          </button>
        </Tooltip>
      </div>

      <div data-tauri-drag-region className="min-w-6 flex-1" />

      {/* Right cluster */}
      <div className="flex items-center gap-1.5 pr-2">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-7 w-56 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-xs text-subtle transition-colors hover:border-honey/40 hover:text-muted max-lg:w-36"
        >
          <Search className="size-3.5" />
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
      {!isMac && (
        <div className="border-l border-line">
          <WindowControls />
        </div>
      )}
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
        'group relative flex h-8 max-w-52 min-w-0 shrink-0 items-center rounded-t-lg text-[13px] transition-colors duration-150',
        active ? 'bg-surface text-fg' : 'text-muted hover:bg-surface/60 hover:text-fg',
      )}
    >
      {active && (
        <motion.span
          layoutId="tab-active"
          className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-honey"
          transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        />
      )}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={label}
        onClick={onClick}
        className={cn('flex h-full min-w-0 items-center gap-2 pl-3', trailing ? 'pr-1' : 'pr-3')}
      >
        {children}
      </button>
      {trailing && <div className="pr-1.5">{trailing}</div>}
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
                  'grid size-5 place-items-center rounded text-subtle hover:bg-surface-3 hover:text-fg',
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
