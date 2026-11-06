import { FolderSync, SquareTerminal } from 'lucide-react'
import { HexAvatar, StatusHex, statusLabel } from '@/components/brand/hex'
import { Tooltip } from '@/components/ui/menu'
import { cn } from '@/lib/cn'
import type { Host } from '@/lib/ipc'
import { useHosts } from '@/stores/hosts'
import { type Tab, targetFromHost, useSessions } from '@/stores/sessions'
import { useUi } from '@/stores/ui'
import { ConnectingCard, EndedBar, ErrorCard, HostKeyCard, SecretCard } from './overlays'
import type { useSshSession } from './useSshSession'

type Session = ReturnType<typeof useSshSession>

/** The bar above a terminal or files tab: who you're connected to, status, then actions. */
export function SessionHeader({ tab, children }: { tab: Tab; children: React.ReactNode }) {
  const t = tab.target
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <HexAvatar
        label={t.label}
        color={t.color}
        icon={t.icon}
        protocol={tab.kind === 'files' ? 'sftp' : 'ssh'}
        size={22}
      />
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-display text-sm font-semibold">{t.label}</span>
        <span className="selectable truncate font-mono text-xs text-subtle">
          {t.username}@{t.hostname}
          {t.port !== 22 ? `:${t.port}` : ''}
        </span>
      </div>
      <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
        <StatusHex status={tab.status} className="size-2" />
        {statusLabel(tab.status)}
      </span>
      <div className="ml-auto flex items-center gap-0.5">{children}</div>
    </div>
  )
}

/**
 * Jumps between the terminal and the files view of the same login: switches to an open tab
 * of the other kind, or opens one.
 */
export function SwitchKindButton({ tab }: { tab: Tab }) {
  const toFiles = tab.kind === 'terminal'
  const Icon = toFiles ? FolderSync : SquareTerminal
  const host = useHostOf(tab)
  return (
    <Tooltip label={toFiles ? 'Browse files over SFTP' : 'Open a terminal on this host'}>
      <button
        type="button"
        onClick={() =>
          useSessions
            .getState()
            .openOrFocus(host ? targetFromHost(host) : tab.target, toFiles ? 'files' : 'terminal')
        }
        className="mr-1 flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted transition-[background-color,color,border-color,scale] duration-150 hover:border-honey/40 hover:bg-surface-2 hover:text-fg active:scale-[0.97] [&_svg]:size-3.5"
      >
        <Icon />
        {toFiles ? 'Files' : 'Terminal'}
      </button>
    </Tooltip>
  )
}

/** The saved host behind a tab, if any (kept current as the host is edited). */
export const useHostOf = (tab: Tab): Host | undefined =>
  useHosts((s) => s.hosts.find((h) => h.id === tab.target.hostId))

/** Connecting, host-key, secret, error and ended screens, shared by both tab kinds. */
export function SessionOverlay({ tab, session }: { tab: Tab; session: Session }) {
  const { close, reconnect } = useSessions.getState()
  const host = useHostOf(tab)
  const editHost = useUi((s) => s.editHost)
  const o = session.overlay
  const t = tab.target
  return (
    <>
      {o?.kind === 'connecting' && (
        <ConnectingCard phase={o.phase} target={t} onCancel={() => close(tab.id)} />
      )}
      {o?.kind === 'hostKey' && <HostKeyCard event={o.event} onAnswer={session.answerHostKey} />}
      {o?.kind === 'secret' && (
        <SecretCard
          key={`${o.secret}-${o.message}`}
          secret={o.secret}
          message={o.message}
          failed={o.failed}
          canRemember={!!t.hostId}
          onSubmit={(a) => session.connect(a)}
          onCancel={() => close(tab.id)}
        />
      )}
      {o?.kind === 'error' && (
        <ErrorCard
          message={o.message}
          onRetry={() => reconnect(tab.id)}
          onClose={() => close(tab.id)}
          onEdit={host ? () => editHost(host) : undefined}
        />
      )}
      {o?.kind === 'ended' && (
        <EndedBar
          exitStatus={o.exitStatus}
          onReconnect={() => reconnect(tab.id)}
          onClose={() => close(tab.id)}
        />
      )}
    </>
  )
}

export function IconBtn({
  label,
  onClick,
  children,
  danger,
  disabled,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
        className={cn(
          'grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5',
          danger && 'hover:bg-rose/12 hover:text-rose',
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}
