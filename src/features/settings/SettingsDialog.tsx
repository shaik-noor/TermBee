import {
  Feather,
  Gauge,
  Laptop,
  Moon,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Wordmark } from '@/components/brand/BeeMark'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/cn'
import { type EffectsPref, resolveEffects } from '@/lib/effects'
import { api, type KnownHost } from '@/lib/ipc'
import { type CursorStyle, type ThemePref, usePrefs } from '@/stores/prefs'
import { useUi } from '@/stores/ui'

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.setSettings)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Rendered unconditionally: Radix mounts it while open and through the exit animation. */}
      <DialogContent
        title="Settings"
        description="Make the hive yours."
        icon={<Settings2 />}
        className="w-[min(600px,calc(100vw-32px))]"
      >
        <SettingsBody />
      </DialogContent>
    </Dialog>
  )
}

function SettingsBody() {
  const p = usePrefs()
  return (
    <div className="space-y-7">
      <Group title="Appearance">
        <Row label="Theme">
          <Segmented<ThemePref>
            value={p.theme}
            onChange={(theme) => p.set({ theme })}
            options={[
              { value: 'hive', label: 'Hive', icon: <Moon /> },
              { value: 'meadow', label: 'Meadow', icon: <Sun /> },
              { value: 'system', label: 'System', icon: <Laptop /> },
            ]}
          />
        </Row>
        <Row
          label="Motion & effects"
          hint={
            p.effects === 'auto'
              ? `Auto chose ${resolveEffects('auto')} for this computer`
              : 'Reduced turns off animation and blur for slower PCs'
          }
        >
          <Segmented<EffectsPref>
            value={p.effects}
            onChange={(effects) => p.set({ effects })}
            options={[
              { value: 'auto', label: 'Auto', icon: <Gauge /> },
              { value: 'full', label: 'Full', icon: <Sparkles /> },
              { value: 'reduced', label: 'Reduced', icon: <Feather /> },
            ]}
          />
        </Row>
      </Group>

      <Group title="Terminal">
        <Row label="Font size" hint="Also Ctrl/⌘ + and −">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={10}
              max={24}
              value={p.fontSize}
              onChange={(e) => p.set({ fontSize: Number(e.target.value) })}
              className="w-40 accent-[var(--honey)]"
              aria-label="Font size"
            />
            <span className="w-10 font-mono text-sm tabular-nums">{p.fontSize}px</span>
          </div>
        </Row>
        <Row label="Cursor">
          <Segmented<CursorStyle>
            value={p.cursorStyle}
            onChange={(cursorStyle) => p.set({ cursorStyle })}
            options={[
              { value: 'bar', label: 'Bar' },
              { value: 'block', label: 'Block' },
              { value: 'underline', label: 'Underline' },
            ]}
          />
        </Row>
        <Row label="Blinking cursor">
          <Toggle checked={p.cursorBlink} onChange={(cursorBlink) => p.set({ cursorBlink })} />
        </Row>
        <Row label="Copy on select" hint="Selected text goes straight to the clipboard">
          <Toggle checked={p.copyOnSelect} onChange={(copyOnSelect) => p.set({ copyOnSelect })} />
        </Row>
        <Row label="Scrollback" hint="Lines kept per tab">
          <select
            value={p.scrollback}
            onChange={(e) => p.set({ scrollback: Number(e.target.value) })}
            className="h-8 rounded-lg border border-line-strong bg-surface-2 px-2 text-sm outline-none focus:border-honey/60"
          >
            {[1000, 5000, 10000, 50000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()} lines
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <KnownHostsGroup />

      <div className="flex items-center justify-between border-t border-line pt-4 text-xs text-subtle">
        <Wordmark className="text-sm text-fg" />
        <span>v{__APP_VERSION__} · Passwords are stored in your system keychain only.</span>
      </div>
    </div>
  )
}

function KnownHostsGroup() {
  const [items, setItems] = useState<KnownHost[] | null>(null)
  useEffect(() => {
    void api.knownHosts
      .list()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])
  const forget = async (k: KnownHost) => {
    await api.knownHosts.forget(k.hostname, k.port)
    setItems(
      (list) => list?.filter((x) => !(x.hostname === k.hostname && x.port === k.port)) ?? null,
    )
    toast.success(`Forgot ${k.hostname}`, {
      description: 'You’ll be asked to verify it on the next connection.',
    })
  }
  return (
    <Group title="Trusted host keys" icon={<ShieldCheck className="size-3.5 text-clover" />}>
      {items === null ? null : items.length === 0 ? (
        <p className="text-sm text-subtle">
          No servers trusted yet. You’ll be asked the first time you connect to each one.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {items.map((k) => (
            <li
              key={`${k.hostname}:${k.port}:${k.algorithm}`}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">
                  {k.hostname}:{k.port} <span className="text-subtle">· {k.algorithm}</span>
                </div>
                <div className="selectable truncate font-mono text-[11px] text-subtle">
                  {k.fingerprint}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void forget(k)}
                aria-label={`Forget ${k.hostname}`}
                className="grid size-7 place-items-center rounded-md text-subtle hover:bg-rose/12 hover:text-rose"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Group>
  )
}

function Group({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
        {icon ?? <span className="hex-clip size-2 bg-honey" />}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-subtle">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: React.ReactNode }[]
}) {
  return (
    <div role="radiogroup" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors [&_svg]:size-3.5',
            value === o.value ? 'bg-honey text-honey-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5.5 w-10 rounded-full transition-colors',
        checked ? 'bg-honey' : 'bg-surface-3',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-4.5 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-4.5',
        )}
      />
    </button>
  )
}
