import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderSearch,
  RotateCw,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '@/components/ui/menu'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { formatEta, formatSize, formatSpeed } from './format'
import type { Transfer } from './useTransfers'

const KIND = {
  upload: { Icon: ArrowUpFromLine, verb: 'Uploaded' },
  download: { Icon: ArrowDownToLine, verb: 'Downloaded' },
  copy: { Icon: Copy, verb: 'Copied' },
} as const

/** The queue under both panes: folds to one summary line, expands to every transfer. */
export function TransfersPanel({
  transfers,
  onCancel,
  onRetry,
  onDismiss,
  onClear,
}: {
  transfers: Transfer[]
  onCancel: (id: string) => void
  onRetry: (t: Transfer) => void
  onDismiss: (id: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(true)
  if (transfers.length === 0) return null
  const running = transfers.filter((t) => t.state === 'running')
  const failed = transfers.filter((t) => t.state === 'failed').length
  const done = running.reduce((s, t) => s + t.progress.done, 0)
  const total = running.reduce((s, t) => s + t.progress.total, 0)
  const speed = running.reduce((s, t) => s + t.speed, 0)

  return (
    <div className="shrink-0 border-t border-line bg-surface animate-rise">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full items-center gap-2 px-4 text-xs text-muted hover:text-fg"
      >
        <ChevronDown
          className={cn('size-3.5 transition-transform duration-200', !open && '-rotate-90')}
        />
        <span className="font-semibold tracking-wider text-subtle uppercase">Transfers</span>
        {running.length > 0 ? (
          <>
            <span className="tabular-nums">
              {running.length} running · {total ? Math.floor((done / total) * 100) : 0}%
            </span>
            <span className="text-subtle tabular-nums">{formatSpeed(speed)}</span>
            <Bar value={total ? done / total : 0} className="ml-2 w-32" />
          </>
        ) : (
          <span className="text-subtle">
            {failed ? `${failed} failed` : 'All done'} · {transfers.length} total
          </span>
        )}
        {running.length < transfers.length && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            onKeyDown={(e) => e.key === 'Enter' && onClear()}
            className="ml-auto rounded px-1.5 py-0.5 text-subtle hover:bg-surface-3 hover:text-fg"
          >
            Clear finished
          </span>
        )}
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="max-h-48 overflow-y-auto pb-1.5">
            {[...transfers].reverse().map((t) => (
              <Row key={t.id} t={t} onCancel={onCancel} onRetry={onRetry} onDismiss={onDismiss} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({
  t,
  onCancel,
  onRetry,
  onDismiss,
}: {
  t: Transfer
  onCancel: (id: string) => void
  onRetry: (t: Transfer) => void
  onDismiss: (id: string) => void
}) {
  const { Icon, verb } = KIND[t.job.kind]
  const p = t.progress
  const pct = p.total ? p.done / p.total : t.state === 'done' ? 1 : 0
  const folder = p.filesTotal > 1
  const status =
    t.state === 'running'
      ? [
          p.total ? `${formatSize(p.done)} of ${formatSize(p.total)}` : 'Starting…',
          formatSpeed(t.speed),
          formatEta(p.total - p.done, t.speed),
        ]
          .filter(Boolean)
          .join(' · ')
      : t.state === 'done'
        ? `${verb} · ${formatSize(p.total)}${folder ? ` · ${p.filesTotal} files` : ''}`
        : t.state === 'cancelled'
          ? 'Cancelled'
          : (t.error ?? 'Failed')

  return (
    <div className="group flex items-center gap-3 px-4 py-1.5 text-xs">
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          t.state === 'failed' ? 'text-rose' : t.state === 'done' ? 'text-clover' : 'text-honey',
        )}
      />
      <div className="w-56 min-w-0 shrink-0">
        <div className="truncate font-medium text-fg" title={t.job.from}>
          {t.name}
        </div>
        {folder && t.state === 'running' && (
          <div className="truncate text-[11px] text-subtle">
            {p.filesDone + 1} of {p.filesTotal} · {p.current}
          </div>
        )}
      </div>
      <Bar
        value={t.state === 'cancelled' ? 0 : pct}
        tone={t.state === 'failed' ? 'rose' : t.state === 'done' ? 'clover' : 'honey'}
        className="min-w-16 flex-1"
      />
      <span
        className={cn(
          'w-60 shrink-0 truncate text-right tabular-nums',
          t.state === 'failed' ? 'text-rose' : 'text-subtle',
        )}
        title={t.error}
      >
        {status}
      </span>
      <div className="flex w-[72px] shrink-0 justify-end gap-0.5">
        {t.state === 'running' && (
          <Act label="Cancel" onClick={() => onCancel(t.id)}>
            <X />
          </Act>
        )}
        {(t.state === 'failed' || t.state === 'cancelled') && (
          <Act label="Retry" onClick={() => onRetry(t)}>
            <RotateCw />
          </Act>
        )}
        {t.state === 'done' && t.localPath && (
          <>
            <Act label="Open" onClick={() => void api.local.open(t.localPath as string)}>
              <ExternalLink />
            </Act>
            <Act
              label="Show in folder"
              onClick={() => void api.local.reveal(t.localPath as string)}
            >
              <FolderSearch />
            </Act>
          </>
        )}
        {t.state !== 'running' && (
          <Act label="Dismiss" onClick={() => onDismiss(t.id)}>
            <X />
          </Act>
        )}
      </div>
    </div>
  )
}

function Bar({
  value,
  tone = 'honey',
  className,
}: {
  value: number
  tone?: 'honey' | 'clover' | 'rose'
  className?: string
}) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-surface-3', className)}>
      {/* scale, not width: progress updates never trigger layout */}
      <div
        className={cn(
          'h-full origin-left rounded-full transition-[scale] duration-150',
          tone === 'rose' ? 'bg-rose' : tone === 'clover' ? 'bg-clover' : 'bg-honey',
        )}
        style={{ scale: `${Math.min(1, Math.max(0, value))} 1` }}
      />
    </div>
  )
}

function Act({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="grid size-6 place-items-center rounded text-subtle hover:bg-surface-3 hover:text-fg [&_svg]:size-3.5"
      >
        {children}
      </button>
    </Tooltip>
  )
}
