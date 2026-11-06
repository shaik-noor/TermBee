import { KeyRound, LockKeyhole, MoreHorizontal, Star } from 'lucide-react'
import { HexAvatar, HOST_COLORS } from '@/components/brand/hex'
import { PROTOCOLS } from '@/components/brand/icons'
import {
  ContextContent,
  ContextMenu,
  ContextTrigger,
  DropdownContent,
  DropdownMenu,
  DropdownTrigger,
} from '@/components/ui/menu'
import { cn } from '@/lib/cn'
import type { Host } from '@/lib/ipc'
import { useHosts } from '@/stores/hosts'
import { HostContextItems, HostDropdownItems } from './HostMenu'
import { address, connectHost, rdpClientName, relativeTime } from './lib'

export function HostCard({ host, live, index = 0 }: { host: Host; live: number; index?: number }) {
  const toggleFavorite = useHosts((s) => s.toggleFavorite)
  const accent = HOST_COLORS[host.color]?.fill ?? HOST_COLORS.honey.fill
  const proto = PROTOCOLS[host.protocol]
  return (
    <ContextMenu>
      <ContextTrigger asChild>
        <div
          className={cn(
            'group relative flex flex-col rounded-2xl border border-line bg-surface p-3.5 shadow-card animate-rise',
            'transition-[border-color,translate,scale] duration-200 ease-out hover:-translate-y-0.5 hover:border-honey/35 active:translate-y-0 active:scale-[0.985]',
            // Accent wash (a gradient, not a blur filter) that warms up on hover, and a glow
            // ring. Both fade with opacity, so hover costs no repaint.
            'before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:bg-[radial-gradient(circle_at_100%_0%,color-mix(in_oklab,var(--accent)_18%,transparent),transparent_55%)] before:opacity-60 before:transition-opacity before:duration-200 hover:before:opacity-100',
            'after:pointer-events-none after:absolute after:-inset-px after:rounded-2xl after:opacity-0 after:shadow-glow after:transition-opacity after:duration-200 hover:after:opacity-100',
          )}
          style={
            {
              '--accent': accent,
              animationDelay: `${Math.min(index, 12) * 24}ms`,
            } as React.CSSProperties
          }
        >
          <button
            type="button"
            onClick={() => connectHost(host)}
            className="absolute inset-0 z-0 rounded-2xl"
            aria-label={
              host.protocol === 'rdp'
                ? `Open ${host.label} in ${rdpClientName}`
                : `Connect to ${host.label}`
            }
          />
          <div className="pointer-events-none relative z-10 flex items-start gap-3">
            <div className="relative">
              <HexAvatar
                label={host.label}
                color={host.color}
                icon={host.icon}
                protocol={host.protocol}
                size={38}
                className="transition-transform duration-300 ease-(--ease-spring) group-hover:scale-105 group-hover:-rotate-3"
              />
              {live > 0 && (
                <span className="absolute -top-1 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full border-2 border-surface bg-clover px-0.5 text-[9px] font-bold text-[#06200e]">
                  {live}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-[15px] font-semibold tracking-tight">
                {host.label}
              </div>
              <div className="truncate font-mono text-xs text-subtle">{address(host)}</div>
            </div>
            <div className="pointer-events-auto -mt-1 -mr-1 flex items-center">
              <button
                type="button"
                aria-label={host.favorite ? 'Unfavorite' : 'Favorite'}
                onClick={() => void toggleFavorite(host)}
                className={cn(
                  'grid size-7 place-items-center rounded-md transition-colors hover:bg-surface-3',
                  host.favorite ? 'text-honey' : 'text-subtle opacity-0 group-hover:opacity-100',
                )}
              >
                <Star className="size-3.5" fill={host.favorite ? 'currentColor' : 'none'} />
              </button>
              <DropdownMenu>
                <DropdownTrigger asChild>
                  <button
                    type="button"
                    aria-label="More actions"
                    className="grid size-7 place-items-center rounded-md text-subtle opacity-0 transition-colors group-hover:opacity-100 hover:bg-surface-3 hover:text-fg data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownTrigger>
                <DropdownContent>
                  <HostDropdownItems host={host} />
                </DropdownContent>
              </DropdownMenu>
            </div>
          </div>

          {host.tags.length > 0 && (
            <div className="pointer-events-none relative z-10 mt-2.5 flex flex-wrap gap-1">
              {host.tags.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="pointer-events-none relative z-10 mt-auto flex min-w-0 items-center gap-2 pt-3 text-[11px] whitespace-nowrap text-subtle">
            <span
              className="flex items-center gap-1 rounded px-1 py-px font-semibold"
              style={{
                color: proto.color,
                background: `color-mix(in oklab, ${proto.color} 14%, transparent)`,
              }}
            >
              <proto.Icon className="size-3" /> {proto.label}
            </span>
            {host.protocol === 'rdp' ? null : host.auth.type === 'key' ? (
              <span className="flex items-center gap-1">
                <KeyRound className="size-3" /> Key
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <LockKeyhole className="size-3" />{' '}
                {host.savedSecrets.password ? 'Password saved' : 'Asks for password'}
              </span>
            )}
            <span className="text-line-strong">•</span>
            <span className="truncate">{relativeTime(host.lastConnectedAt)}</span>
            <span className="ml-auto translate-x-1 rounded-md bg-honey px-2 py-0.5 text-[11px] font-semibold text-honey-fg opacity-0 transition-[opacity,translate,scale] duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100">
              {host.protocol === 'ssh' ? 'Connect' : 'Open'}
            </span>
          </div>
        </div>
      </ContextTrigger>
      <ContextContent>
        <HostContextItems host={host} />
      </ContextContent>
    </ContextMenu>
  )
}
