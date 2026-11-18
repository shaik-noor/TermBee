import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Feather,
  FileCode2,
  Gauge,
  Laptop,
  Moon,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Wordmark } from '@/components/brand/BeeMark'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/cn'
import { type EffectsPref, resolveEffects } from '@/lib/effects'
import {
  api,
  type ConflictReason,
  type ConflictResolution,
  type ImportConflict,
  type ImportPreview,
  type KnownHost,
} from '@/lib/ipc'
import { isTauri } from '@/lib/platform'
import { useHosts } from '@/stores/hosts'
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
        className="w-[min(640px,calc(100vw-32px))]"
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

      <BackupAndMigrationGroup />

      <KnownHostsGroup />

      <div className="flex items-center justify-between border-t border-line pt-4 text-xs text-subtle">
        <Wordmark className="text-sm text-fg" />
        <span>v{__APP_VERSION__} · Passwords are stored in your system keychain only.</span>
      </div>
    </div>
  )
}

const REASON_LABELS: Record<ConflictReason, string> = {
  sameId: 'Same host ID',
  sameAddress: 'Same user@host:port',
  sameName: 'Same name in folder',
}

function BackupAndMigrationGroup() {
  const hosts = useHosts((s) => s.hosts)
  const setHive = useHosts((s) => s.setHive)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({})

  const handleExport = async () => {
    setBusy(true)
    try {
      let path: string | null = 'termbee-hive.xml'
      if (isTauri) {
        path = await saveFileDialog({
          title: 'Export TermBee Hive (.xml)',
          defaultPath: `termbee-hive-${new Date().toISOString().slice(0, 10)}.xml`,
          filters: [{ name: 'TermBee XML', extensions: ['xml'] }],
        })
      }
      if (!path) return
      const res = await api.hosts.exportXml(path, includeSecrets)
      toast.success(
        `Exported ${res.hostsCount} ${res.hostsCount === 1 ? 'host' : 'hosts'} to XML`,
        {
          description: res.includedSecrets
            ? 'Saved keychain passwords and passphrases were included in the export.'
            : 'Exported without passwords or passphrases.',
        },
      )
    } catch (err) {
      toast.error('Couldn’t export XML', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const handleChooseImport = async () => {
    setBusy(true)
    try {
      let path: string | null = 'termbee-hive.xml'
      if (isTauri) {
        const picked = await openFileDialog({
          title: 'Import TermBee Hive (.xml)',
          multiple: false,
          directory: false,
          filters: [{ name: 'TermBee XML', extensions: ['xml'] }],
        })
        path = typeof picked === 'string' ? picked : null
      }
      if (!path) return
      const p = await api.hosts.importPreview(path)
      const initial: Record<string, ConflictResolution> = {}
      for (const c of p.conflicts) {
        initial[c.incomingId] = 'skip'
      }
      setResolutions(initial)
      setPreview(p)
    } catch (err) {
      toast.error('Couldn’t read XML file', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const setAllResolutions = (action: ConflictResolution) => {
    if (!preview) return
    const next: Record<string, ConflictResolution> = {}
    for (const c of preview.conflicts) {
      next[c.incomingId] = action
    }
    setResolutions(next)
  }

  const applyImport = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const res = await api.hosts.importApply(preview.path, resolutions)
      setHive(res.hive)
      setPreview(null)
      const parts: string[] = []
      if (res.added > 0) parts.push(`${res.added} added`)
      if (res.replaced > 0) parts.push(`${res.replaced} replaced`)
      if (res.skipped > 0) parts.push(`${res.skipped} skipped`)
      toast.success('Hive import complete', {
        description: parts.length ? parts.join(' · ') : 'No changes were needed.',
      })
    } catch (err) {
      toast.error('Couldn’t import XML', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Group title="Backup & migration (XML)" icon={<FileCode2 className="size-3.5 text-honey" />}>
      <p className="text-xs leading-relaxed text-subtle">
        Moving to another laptop or reinstalling? Export your hosts, folders, trusted keys, and
        keychain logins to a <code className="font-mono text-muted">.xml</code> file and import them
        anytime.
      </p>
      <Row
        label="Include saved passwords & passphrases"
        hint={
          includeSecrets
            ? 'Writes saved passwords and passphrases into an unencrypted file'
            : 'Exports only host addresses, folders, and settings (no secrets)'
        }
      >
        <Toggle checked={includeSecrets} onChange={setIncludeSecrets} />
      </Row>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || hosts.length === 0}
          onClick={() => void handleExport()}
        >
          <Download /> Export to .xml…
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void handleChooseImport()}
        >
          <Upload /> Import from .xml…
        </Button>
      </div>

      {preview && (
        <div className="mt-3 space-y-3 rounded-xl border border-honey/40 bg-surface-2/60 p-3.5 animate-rise">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Review XML import</div>
              <div className="text-xs text-subtle">
                {preview.newHosts.length} new {preview.newHosts.length === 1 ? 'host' : 'hosts'} ·{' '}
                {preview.conflicts.length}{' '}
                {preview.conflicts.length === 1 ? 'conflict' : 'conflicts'} · {preview.foldersCount}{' '}
                {preview.foldersCount === 1 ? 'folder' : 'folders'}
                {preview.includesSecrets ? ' · Includes keychain logins' : ''}
                {preview.knownHostsCount > 0
                  ? ` · ${preview.knownHostsCount} trusted SSH keys`
                  : ''}
              </div>
            </div>
            {preview.conflicts.length > 1 && (
              <div className="flex items-center gap-1 text-[11px]">
                <span className="mr-1 text-subtle">All conflicts:</span>
                <button
                  type="button"
                  onClick={() => setAllResolutions('replace')}
                  className="rounded border border-line bg-surface px-2 py-0.5 text-muted hover:border-honey/50 hover:text-fg"
                >
                  Replace all
                </button>
                <button
                  type="button"
                  onClick={() => setAllResolutions('keepBoth')}
                  className="rounded border border-line bg-surface px-2 py-0.5 text-muted hover:border-honey/50 hover:text-fg"
                >
                  Keep both
                </button>
                <button
                  type="button"
                  onClick={() => setAllResolutions('skip')}
                  className="rounded border border-line bg-surface px-2 py-0.5 text-muted hover:border-honey/50 hover:text-fg"
                >
                  Skip all
                </button>
              </div>
            )}
          </div>

          {preview.conflicts.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>
                  {preview.conflicts.length === 1
                    ? '1 host conflicts with an existing host in your hive. Choose how to resolve it:'
                    : `${preview.conflicts.length} hosts conflict with existing hosts in your hive. Choose how to resolve each:`}
                </span>
              </div>
              <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface">
                {preview.conflicts.map((c) => (
                  <ConflictRow
                    key={c.incomingId}
                    conflict={c}
                    value={resolutions[c.incomingId] ?? 'replace'}
                    onChange={(v) => setResolutions((prev) => ({ ...prev, [c.incomingId]: v }))}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-clover">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>
                No conflicts found — all {preview.newHosts.length} hosts are ready to add.
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button variant="honey" size="sm" disabled={busy} onClick={() => void applyImport()}>
              {busy ? 'Importing…' : 'Apply import'}
            </Button>
          </div>
        </div>
      )}
    </Group>
  )
}

function ConflictRow({
  conflict,
  value,
  onChange,
}: {
  conflict: ImportConflict
  value: ConflictResolution
  onChange: (v: ConflictResolution) => void
}) {
  const { incoming, existing, reason } = conflict
  return (
    <li className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-semibold">{incoming.label}</span>
          <span className="rounded bg-amber/15 px-1.5 py-px text-[10px] font-medium text-amber">
            {REASON_LABELS[reason]}
          </span>
        </div>
        <div className="truncate font-mono text-[11px] text-subtle">
          XML: {incoming.username}@{incoming.hostname}:{incoming.port}
          {incoming.group ? ` (${incoming.group})` : ''}
        </div>
        {(existing.label !== incoming.label ||
          existing.hostname !== incoming.hostname ||
          existing.port !== incoming.port ||
          existing.username !== incoming.username) && (
          <div className="truncate font-mono text-[11px] text-subtle">
            Current: {existing.label} · {existing.username}@{existing.hostname}:{existing.port}
          </div>
        )}
      </div>
      <Segmented<ConflictResolution>
        value={value}
        onChange={onChange}
        options={[
          { value: 'replace', label: 'Replace' },
          { value: 'keepBoth', label: 'Keep both' },
          { value: 'skip', label: 'Skip' },
        ]}
      />
    </li>
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
