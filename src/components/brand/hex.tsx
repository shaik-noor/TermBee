import { cn } from '@/lib/cn'
import type { HostColor, Protocol } from '@/lib/ipc'
import type { TabStatus } from '@/stores/sessions'
import { HOST_ICONS, PROTOCOLS } from './icons'

/** Per-host accent colors (fixed hues that read on both themes). */
export const HOST_COLORS: Record<HostColor, { fill: string; text: string; name: string }> = {
  honey: { fill: '#F9B21A', text: '#1C1408', name: 'Honey' },
  amber: { fill: '#F07F2E', text: '#1F0E02', name: 'Amber' },
  clover: { fill: '#5FC77A', text: '#06200E', name: 'Clover' },
  sky: { fill: '#5BB3F0', text: '#04182A', name: 'Sky' },
  lilac: { fill: '#B591F5', text: '#1A0B33', name: 'Lilac' },
  rose: { fill: '#F2706A', text: '#2A0705', name: 'Rose' },
  slate: { fill: '#9AA3AE', text: '#11161C', name: 'Slate' },
}

export const HOST_COLOR_KEYS = Object.keys(HOST_COLORS) as HostColor[]

export function initials(label: string): string {
  const parts = label.split(/[\s\-_.]+/).filter(Boolean)
  const raw = parts.length > 1 ? parts[0][0] + parts[1][0] : label.slice(0, 2)
  return raw.toUpperCase()
}

/**
 * A host's avatar: a honeycomb cell in its color showing its icon (or initials), with a
 * small protocol badge (SSH / SFTP / RDP) in the corner when `protocol` is given.
 */
export function HexAvatar({
  label,
  color,
  icon,
  protocol,
  size = 36,
  className,
}: {
  label: string
  color: HostColor
  icon?: string | null
  protocol?: Protocol
  size?: number
  className?: string
}) {
  const c = HOST_COLORS[color] ?? HOST_COLORS.honey
  const Icon = icon ? HOST_ICONS[icon]?.Icon : undefined
  const cell = (
    <div
      className={cn(
        'hex-clip grid shrink-0 place-items-center font-display font-bold',
        !protocol && className,
      )}
      style={{
        width: size,
        height: size * 1.08,
        background: `linear-gradient(160deg, color-mix(in oklab, ${c.fill} 82%, white) 0%, ${c.fill} 55%, color-mix(in oklab, ${c.fill} 80%, black) 100%)`,
        color: c.text,
        fontSize: size * 0.36,
      }}
      aria-hidden="true"
    >
      {Icon ? (
        <Icon style={{ width: size * 0.46, height: size * 0.46 }} strokeWidth={2.2} />
      ) : (
        initials(label)
      )}
    </div>
  )
  if (!protocol) return cell
  const p = PROTOCOLS[protocol]
  const badge = Math.max(11, Math.round(size * 0.44))
  return (
    <div className={cn('relative shrink-0', className)} aria-hidden="true">
      {cell}
      <span
        title={p.long}
        className="absolute -right-1 -bottom-0.5 grid place-items-center rounded-full ring-2 ring-surface"
        style={{ width: badge, height: badge, background: p.color, color: '#140f07' }}
      >
        <p.Icon style={{ width: badge * 0.62, height: badge * 0.62 }} strokeWidth={2.6} />
      </span>
    </div>
  )
}

const STATUS_STYLE: Record<TabStatus, { cls: string; label: string; pulse?: boolean }> = {
  idle: { cls: 'bg-subtle', label: 'Idle' },
  connecting: { cls: 'bg-honey', label: 'Connecting', pulse: true },
  handshake: { cls: 'bg-honey', label: 'Securing', pulse: true },
  authenticating: { cls: 'bg-honey', label: 'Logging in', pulse: true },
  connected: { cls: 'bg-clover', label: 'Connected' },
  closed: { cls: 'bg-subtle', label: 'Disconnected' },
  error: { cls: 'bg-rose', label: 'Failed' },
}

export const statusLabel = (s: TabStatus) => STATUS_STYLE[s].label

/** Tiny hexagonal status light. */
export function StatusHex({ status, className }: { status: TabStatus; className?: string }) {
  const s = STATUS_STYLE[status]
  return (
    <span
      role="img"
      aria-label={s.label}
      className={cn(
        'hex-clip inline-block size-2.5 shrink-0',
        s.cls,
        s.pulse && 'animate-pulse',
        className,
      )}
    />
  )
}
