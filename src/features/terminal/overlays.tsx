import {
  AlertTriangle,
  KeyRound,
  Loader2,
  LockKeyhole,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { BeeMark } from '@/components/brand/BeeMark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import type { SessionPhase } from '@/lib/ipc'
import type { Target } from '@/stores/sessions'
import type { HostKeyEvent, SecretAnswer } from './useSshSession'

function Card({
  children,
  tone = 'honey',
  className,
}: {
  children: ReactNode
  tone?: 'honey' | 'rose'
  className?: string
}) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-[#100c07]/80 p-6 backdrop-blur-[3px] animate-fade-in">
      <div
        className={cn(
          'w-full max-w-md rounded-2xl border bg-[#1c1710] p-6 text-[#f6eedc] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8)] animate-pop-in',
          tone === 'rose' ? 'border-[#ff7a6b]/30' : 'border-[#f9b21a]/20',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

const PHASES: { id: SessionPhase; label: string }[] = [
  { id: 'connecting', label: 'Reaching the host' },
  { id: 'handshake', label: 'Securing the connection' },
  { id: 'authenticating', label: 'Logging in' },
]

export function ConnectingCard({
  phase,
  target,
  onCancel,
}: {
  phase: SessionPhase
  target: Target
  onCancel: () => void
}) {
  const current = PHASES.findIndex((p) => p.id === phase)
  return (
    <Card>
      <div className="flex flex-col items-center text-center">
        <BeeMark buzzing className="h-14" />
        <h3 className="mt-4 font-display text-lg font-semibold">Flying to {target.label}</h3>
        <p className="mt-1 font-mono text-xs text-[#b8aa8e]">
          {target.username}@{target.hostname}:{target.port}
        </p>
      </div>
      <ol className="mt-6 space-y-2.5">
        {PHASES.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                'hex-clip grid size-5 place-items-center text-[10px] font-bold',
                i < current && 'bg-[#7bd88f] text-[#06200e]',
                i === current && 'bg-[#f9b21a] text-[#1c1408]',
                i > current && 'bg-[#2f281c] text-[#7f735e]',
              )}
            >
              {i < current ? '✓' : i + 1}
            </span>
            <span className={cn(i > current ? 'text-[#7f735e]' : 'text-[#f6eedc]')}>{p.label}</span>
            {i === current && <Loader2 className="ml-auto size-4 animate-spin text-[#f9b21a]" />}
          </li>
        ))}
      </ol>
      <div className="mt-6 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="text-[#b8aa8e] hover:bg-[#2f281c] hover:text-[#f6eedc]"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </Card>
  )
}

export function HostKeyCard({
  event,
  onAnswer,
}: {
  event: HostKeyEvent
  onAnswer: (accept: boolean) => void
}) {
  const changed = event.kind === 'changed'
  return (
    <Card tone={changed ? 'rose' : 'honey'} className="max-w-lg">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'hex-clip grid size-10 shrink-0 place-items-center',
            changed ? 'bg-[#ff7a6b]/15 text-[#ff7a6b]' : 'bg-[#f9b21a]/15 text-[#f9b21a]',
          )}
        >
          {changed ? <ShieldAlert className="size-5" /> : <ShieldCheck className="size-5" />}
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold">
            {changed ? 'This host’s identity changed' : 'First visit to this host'}
          </h3>
          <p className="mt-1 text-sm text-[#b8aa8e]">
            {changed
              ? 'The server sent a different key than last time. This can happen after a reinstall, but it can also mean someone is intercepting the connection. Only continue if you expected this.'
              : 'TermBee hasn’t seen this server before. Check the fingerprint with your admin or the server console, then trust it to continue.'}
          </p>
        </div>
      </div>
      <dl className="mt-5 space-y-2 rounded-xl border border-[#f9b21a]/10 bg-[#100c07] p-3.5 text-xs">
        <Row label="Host" value={`${event.hostname}:${event.port}`} />
        <Row label="Key type" value={event.algorithm} />
        <Row label="Fingerprint" value={event.fingerprint} strong />
        {event.previousFingerprint && (
          <Row label="Previously" value={event.previousFingerprint} muted />
        )}
      </dl>
      <div className="mt-5 flex justify-end gap-2">
        <Button
          variant="ghost"
          className="text-[#b8aa8e] hover:bg-[#2f281c] hover:text-[#f6eedc]"
          onClick={() => onAnswer(false)}
        >
          Cancel
        </Button>
        <Button variant={changed ? 'danger' : 'honey'} onClick={() => onAnswer(true)}>
          {changed ? 'Trust the new key' : 'Trust and connect'}
        </Button>
      </div>
    </Card>
  )
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2">
      <dt className="text-[#7f735e]">{label}</dt>
      <dd
        className={cn(
          'selectable font-mono break-all',
          strong && 'text-[#ffd866]',
          muted && 'text-[#7f735e] line-through',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export function SecretCard({
  secret,
  message,
  failed,
  canRemember,
  onSubmit,
  onCancel,
}: {
  secret: 'password' | 'passphrase'
  message: string
  failed: boolean
  canRemember: boolean
  onSubmit: (a: SecretAnswer) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const [remember, setRemember] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value) onSubmit({ secret, value, remember: canRemember && remember })
  }
  return (
    <Card tone={failed ? 'rose' : 'honey'}>
      <form onSubmit={submit}>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'hex-clip grid size-10 shrink-0 place-items-center',
              failed ? 'bg-[#ff7a6b]/15 text-[#ff7a6b]' : 'bg-[#f9b21a]/15 text-[#f9b21a]',
            )}
          >
            {secret === 'password' ? (
              <LockKeyhole className="size-5" />
            ) : (
              <KeyRound className="size-5" />
            )}
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold">
              {failed
                ? 'Let’s try that again'
                : secret === 'password'
                  ? 'Password needed'
                  : 'Unlock your key'}
            </h3>
            <p className={cn('mt-1 text-sm', failed ? 'text-[#ff9289]' : 'text-[#b8aa8e]')}>
              {message}
            </p>
          </div>
        </div>
        <Input
          ref={input}
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={secret === 'password' ? 'Password' : 'Key passphrase'}
          className="mt-5 border-[#f9b21a]/20 bg-[#100c07] text-[#f6eedc]"
        />
        {canRemember && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-[#b8aa8e]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 accent-[#f9b21a]"
            />
            Remember in{' '}
            {navigator.userAgent.includes('Mac')
              ? 'the macOS Keychain'
              : 'Windows Credential Manager'}
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="ghost"
            className="text-[#b8aa8e] hover:bg-[#2f281c] hover:text-[#f6eedc]"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" variant="honey" disabled={!value}>
            Log in
          </Button>
        </div>
      </form>
    </Card>
  )
}

export function ErrorCard({
  message,
  onRetry,
  onClose,
  onEdit,
}: {
  message: string
  onRetry: () => void
  onClose: () => void
  onEdit?: () => void
}) {
  return (
    <Card tone="rose">
      <div className="flex items-start gap-3">
        <div className="hex-clip grid size-10 shrink-0 place-items-center bg-[#ff7a6b]/15 text-[#ff7a6b]">
          <AlertTriangle className="size-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">Couldn’t connect</h3>
          <p className="selectable mt-1 text-sm break-words text-[#b8aa8e]">{message}</p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button
          variant="ghost"
          className="text-[#b8aa8e] hover:bg-[#2f281c] hover:text-[#f6eedc]"
          onClick={onClose}
        >
          <X /> Close tab
        </Button>
        {onEdit && (
          <Button
            variant="outline"
            className="border-[#f9b21a]/20 text-[#f6eedc] hover:bg-[#2f281c]"
            onClick={onEdit}
          >
            Edit host
          </Button>
        )}
        <Button variant="honey" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      </div>
    </Card>
  )
}

/** Slim bar at the bottom of a finished session (the scrollback stays readable above). */
export function EndedBar({
  exitStatus,
  onReconnect,
  onClose,
}: {
  exitStatus: number | null
  onReconnect: () => void
  onClose: () => void
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-[#f9b21a]/15 bg-[#1c1710]/95 px-4 py-2.5 text-sm text-[#f6eedc] backdrop-blur animate-rise">
      <span className="hex-clip size-2.5 bg-[#7f735e]" />
      <span>
        Session ended{exitStatus !== null && exitStatus !== 0 ? ` (exit code ${exitStatus})` : ''}.
        <span className="text-[#b8aa8e]"> Press Enter to reconnect.</span>
      </span>
      <div className="ml-auto flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-[#b8aa8e] hover:bg-[#2f281c] hover:text-[#f6eedc]"
          onClick={onClose}
        >
          Close tab
        </Button>
        <Button size="sm" variant="honey" onClick={onReconnect}>
          <RotateCw /> Reconnect
        </Button>
      </div>
    </div>
  )
}
