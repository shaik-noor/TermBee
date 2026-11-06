import { ArrowRight, Clock3, KeyRound, Plus, ShieldCheck, Zap } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { BeeMark } from '@/components/brand/BeeMark'
import { HexAvatar } from '@/components/brand/hex'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { label as shortcut } from '@/lib/shortcuts'
import { useHosts } from '@/stores/hosts'
import { parseQuickTarget, quickKind, useSessions } from '@/stores/sessions'
import { useUi } from '@/stores/ui'
import { HostCard } from './HostCard'
import {
  connectHost,
  folderTitle,
  groupHosts,
  openHostAs,
  recentHosts,
  relativeTime,
  useLiveCounts,
} from './lib'

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Burning the midnight honey'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The "Hive": home dashboard with quick connect, recents and every saved host. */
export function HiveHome() {
  const hosts = useHosts((s) => s.hosts)
  const loaded = useHosts((s) => s.loaded)
  const tabs = useSessions((s) => s.tabs)
  const live = useLiveCounts()
  const editHost = useUi((s) => s.editHost)
  const recents = useMemo(() => recentHosts(hosts), [hosts])
  const groups = useMemo(() => groupHosts(hosts), [hosts])
  const liveCount = tabs.filter((t) => t.status === 'connected').length

  return (
    <div className="h-full overflow-y-auto">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="bg-honeycomb absolute inset-0 [mask-image:radial-gradient(ellipse_75%_120%_at_85%_0%,black_10%,transparent_70%)]" />
        <div className="fx-decor pointer-events-none absolute -top-32 right-[8%] size-96 rounded-full bg-honey/10 blur-3xl" />
        <div className="relative mx-auto flex max-w-6xl items-center gap-8 px-8 pt-7 pb-6">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-honey">{greeting()}</p>
            <h1 className="mt-0.5 font-display text-[28px] leading-tight font-bold tracking-tight">
              Welcome to the hive.
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              {hosts.length === 0
                ? 'Save the servers you work on and reach any of them in a keystroke.'
                : `${hosts.length} ${hosts.length === 1 ? 'host' : 'hosts'} saved · ${liveCount} live ${liveCount === 1 ? 'session' : 'sessions'}`}
            </p>
            <QuickConnect className="mt-5" />
          </div>
          <div className="relative hidden shrink-0 md:block">
            <div className="hex-clip absolute inset-0 m-auto size-36 bg-honey/8" />
            <BeeMark
              buzzing
              className="relative h-28 will-change-transform drop-shadow-[0_18px_30px_rgba(249,178,26,0.25)]"
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-8 py-6">
        {!loaded ? null : hosts.length === 0 ? (
          <EmptyHive onAdd={() => editHost('new')} />
        ) : (
          <>
            {recents.length > 0 && (
              <section className="mb-7">
                <SectionTitle icon={<Clock3 />} title="Jump back in" />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                  {recents.map((h, i) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => connectHost(h)}
                      className="group flex items-center gap-3 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5 text-left transition-[background-color,border-color,translate,scale] duration-150 animate-rise hover:border-honey/40 hover:bg-surface-2 active:scale-[0.98]"
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      <HexAvatar
                        label={h.label}
                        color={h.color}
                        icon={h.icon}
                        protocol={h.protocol}
                        size={30}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{h.label}</div>
                        <div className="truncate text-[11px] text-subtle">
                          {relativeTime(h.lastConnectedAt)}
                        </div>
                      </div>
                      <ArrowRight className="size-4 text-subtle transition-[translate,scale,color] group-hover:translate-x-0.5 group-hover:text-honey" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {groups.map(([group, list]) => (
              <section key={group} className="mb-7">
                <SectionTitle title={folderTitle(group)} count={list.length} />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-3">
                  {list.map((h, i) => (
                    <HostCard key={h.id} host={h} live={live[h.id] ?? 0} index={i} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function SectionTitle({
  title,
  count,
  icon,
}: {
  title: string
  count?: number
  icon?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon ? (
        <span className="text-honey [&_svg]:size-4">{icon}</span>
      ) : (
        <span className="hex-clip size-2.5 bg-honey" />
      )}
      <h2 className="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
      {count !== undefined && <span className="text-xs text-subtle tabular-nums">{count}</span>}
      <div className="ml-2 h-px flex-1 bg-line" />
    </div>
  )
}

function QuickConnect({ className }: { className?: string }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const open = useSessions((s) => s.open)
  const hosts = useHosts((s) => s.hosts)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const target = parseQuickTarget(value)
    if (!target) {
      setError('Use the form user@host or user@host:port')
      return
    }
    // Prefer the saved host (keychain password, color) when the address matches one.
    const saved = hosts.find(
      (h) =>
        h.hostname === target.hostname && h.username === target.username && h.port === target.port,
    )
    const kind = quickKind(value)
    if (saved) openHostAs(saved, kind)
    else open(target, kind)
    setValue('')
    setError(null)
  }

  return (
    <form onSubmit={submit} className={cn('max-w-xl', className)}>
      <div className="group flex h-11 items-center gap-3 rounded-2xl border border-line-strong bg-surface pr-1.5 pl-4 shadow-card transition-[border-color,box-shadow] duration-200 focus-within:border-honey/60 focus-within:shadow-glow">
        <Zap className="size-4 shrink-0 text-honey" />
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          placeholder="Quick connect — user@host:port  (sftp user@host for files)"
          spellCheck={false}
          aria-label="Quick connect"
          aria-invalid={!!error}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-subtle"
        />
        <Button
          type="submit"
          variant="honey"
          size="sm"
          className="h-8 rounded-xl px-3.5"
          disabled={!value.trim()}
        >
          Connect <ArrowRight />
        </Button>
      </div>
      <p className={cn('mt-2 pl-1 text-xs', error ? 'text-rose' : 'text-subtle')}>
        {error ?? (
          <>
            Or press <Kbd>{shortcut('palette')}</Kbd> anywhere to find a host.
          </>
        )}
      </p>
    </form>
  )
}

function EmptyHive({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="relative mx-auto mt-4 max-w-2xl overflow-hidden rounded-3xl border border-dashed border-honey/30 bg-surface/70 px-10 py-12 text-center animate-rise">
      <div className="bg-honeycomb absolute inset-0 opacity-60 [mask-image:radial-gradient(circle_at_50%_0%,black,transparent_75%)]" />
      <div className="relative">
        <BeeMark buzzing className="mx-auto h-20" />
        <h2 className="mt-5 font-display text-2xl font-bold tracking-tight">Your hive is empty</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Add a server once and TermBee remembers it: its address, its login and its host key.
          Passwords go straight to your system keychain, never to a file.
        </p>
        <Button variant="honey" size="lg" className="mt-7" onClick={onAdd}>
          <Plus /> Add your first host
        </Button>
        <div className="mt-9 grid grid-cols-3 gap-3 text-left">
          <Tip
            icon={<Zap />}
            title="Quick connect"
            body="Type user@host above for a one-off session."
          />
          <Tip
            icon={<KeyRound />}
            title="Keys or passwords"
            body="Use your ~/.ssh keys or a saved password."
          />
          <Tip
            icon={<ShieldCheck />}
            title="Host-key checks"
            body="Warns you if a server’s identity changes."
          />
        </div>
      </div>
    </div>
  )
}

function Tip({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 p-3.5">
      <div className="text-honey [&_svg]:size-4">{icon}</div>
      <div className="mt-2 text-[13px] font-semibold">{title}</div>
      <div className="mt-0.5 text-xs text-subtle">{body}</div>
    </div>
  )
}
