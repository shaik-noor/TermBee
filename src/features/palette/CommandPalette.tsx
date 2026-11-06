import * as D from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { Hexagon, Moon, PanelLeft, Plus, Settings2, Sun, Zap } from 'lucide-react'
import { useState } from 'react'
import { HexAvatar } from '@/components/brand/hex'
import { Kbd } from '@/components/ui/input'
import { address, connectHost } from '@/features/hosts/lib'
import { label as shortcut } from '@/lib/shortcuts'
import { useHosts } from '@/stores/hosts'
import { resolveDark, usePrefs } from '@/stores/prefs'
import { HOME, parseQuickTarget, quickKind, useSessions } from '@/stores/sessions'
import { useUi } from '@/stores/ui'

const itemCls =
  'flex h-10 cursor-default items-center gap-3 rounded-lg px-3 text-sm text-fg outline-none transition-colors duration-100 data-[selected=true]:bg-honey-soft [&_svg]:size-4 [&_svg]:text-muted'

/** ⌘K / Ctrl+Shift+P: find a host, quick-connect `user@host`, or run an action. */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPalette)
  const setSettings = useUi((s) => s.setSettings)
  const editHost = useUi((s) => s.editHost)
  const hosts = useHosts((s) => s.hosts)
  const tabs = useSessions((s) => s.tabs)
  const { open: openTab, activate } = useSessions.getState()
  const sidebarOpen = usePrefs((s) => s.sidebarOpen)
  const theme = usePrefs((s) => s.theme)
  const setPrefs = usePrefs((s) => s.set)
  const [query, setQuery] = useState('')
  const quick = parseQuickTarget(query)

  const run = (fn: () => void) => {
    setOpen(false)
    setQuery('')
    fn()
  }

  const sorted = [...hosts].sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? ''),
  )

  return (
    <D.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery('')
      }}
    >
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] animate-fade-in data-[state=closed]:animate-fade-out" />
        <D.Content
          aria-label="Command palette"
          className="fixed top-[14vh] left-1/2 z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-card outline-none animate-pop-in data-[state=closed]:animate-pop-out"
        >
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">
            Search hosts, quick connect, or run a command
          </D.Description>
          <Command loop label="Command palette" className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Hexagon className="size-4 text-honey" strokeWidth={2.4} />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search hosts or type user@host…"
                className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-subtle">
                No matches. Try <span className="font-mono text-muted">user@host</span> to connect
                directly.
              </Command.Empty>

              {quick && (
                <Command.Group heading="Quick connect" className="cmdk-group">
                  <Command.Item
                    value={`quick ${query}`}
                    onSelect={() => run(() => openTab(quick, quickKind(query)))}
                    className={itemCls}
                  >
                    <Zap className="!text-honey" />
                    <span>
                      {quickKind(query) === 'files' ? 'Browse files on' : 'Connect to'}{' '}
                      <span className="font-mono">{address(quick)}</span>
                    </span>
                    <span className="ml-auto text-xs text-subtle">Enter</span>
                  </Command.Item>
                  <Command.Item
                    value={`save ${query}`}
                    onSelect={() =>
                      run(() =>
                        editHost('new', {
                          hostname: quick.hostname,
                          username: quick.username,
                          port: quick.port,
                          label: quick.hostname,
                        }),
                      )
                    }
                    className={itemCls}
                  >
                    <Plus />
                    <span>Save as a new host…</span>
                  </Command.Item>
                </Command.Group>
              )}

              {tabs.length > 0 && (
                <Command.Group heading="Open tabs" className="cmdk-group">
                  {tabs.map((t) => (
                    <Command.Item
                      key={t.id}
                      value={`tab ${t.target.label} ${t.id}`}
                      onSelect={() => run(() => activate(t.id))}
                      className={itemCls}
                    >
                      <HexAvatar
                        label={t.target.label}
                        color={t.target.color}
                        icon={t.target.icon}
                        protocol={t.kind === 'files' ? 'sftp' : 'ssh'}
                        size={20}
                      />
                      <span className="truncate">{t.target.label}</span>
                      <span className="ml-auto text-xs text-subtle">Switch to tab</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {sorted.length > 0 && (
                <Command.Group heading="Hosts" className="cmdk-group">
                  {sorted.map((h) => (
                    <Command.Item
                      key={h.id}
                      value={`${h.label} ${h.hostname} ${h.username} ${h.group ?? ''} ${h.tags.join(' ')} ${h.id}`}
                      onSelect={() => run(() => connectHost(h))}
                      className={itemCls}
                    >
                      <HexAvatar
                        label={h.label}
                        color={h.color}
                        icon={h.icon}
                        protocol={h.protocol}
                        size={24}
                      />
                      <div className="min-w-0">
                        <div className="truncate">{h.label}</div>
                      </div>
                      <span className="truncate font-mono text-xs text-subtle">{address(h)}</span>
                      {h.group && (
                        <span className="ml-auto shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                          {h.group}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Actions" className="cmdk-group">
                <Action
                  label="New host…"
                  hint={shortcut('newHost')}
                  icon={<Plus />}
                  onSelect={() => run(() => editHost('new'))}
                />
                <Action
                  label="Go to the Hive"
                  icon={<Hexagon />}
                  onSelect={() => run(() => activate(HOME))}
                />
                <Action
                  label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                  hint={shortcut('sidebar')}
                  icon={<PanelLeft />}
                  onSelect={() => run(() => setPrefs({ sidebarOpen: !sidebarOpen }))}
                />
                <Action
                  label={resolveDark(theme) ? 'Switch to Meadow (light)' : 'Switch to Hive (dark)'}
                  icon={resolveDark(theme) ? <Sun /> : <Moon />}
                  onSelect={() =>
                    run(() => setPrefs({ theme: resolveDark(theme) ? 'meadow' : 'hive' }))
                  }
                />
                <Action
                  label="Settings"
                  hint={shortcut('settings')}
                  icon={<Settings2 />}
                  onSelect={() => run(() => setSettings(true))}
                />
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-4 border-t border-line bg-surface-2/50 px-4 py-2 text-[11px] text-subtle">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>Enter</Kbd> open
              </span>
              <span className="ml-auto">TermBee</span>
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

function Action({
  label,
  hint,
  icon,
  onSelect,
}: {
  label: string
  hint?: string
  icon: React.ReactNode
  onSelect: () => void
}) {
  return (
    <Command.Item value={`action ${label}`} onSelect={onSelect} className={itemCls}>
      {icon}
      <span>{label}</span>
      {hint && <span className="ml-auto text-xs text-subtle">{hint}</span>}
    </Command.Item>
  )
}
