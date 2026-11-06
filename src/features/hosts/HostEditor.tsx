import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import {
  CaseSensitive,
  FolderOpen,
  FolderSync,
  KeyRound,
  LockKeyhole,
  Monitor,
  Server,
  SquareTerminal,
  Star,
} from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { HexAvatar, HOST_COLOR_KEYS, HOST_COLORS } from '@/components/brand/hex'
import { HOST_ICON_KEYS, HOST_ICONS, PROTOCOLS } from '@/components/brand/icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import {
  api,
  type Host,
  type HostColor,
  type HostInput,
  type Protocol,
  type SecretUpdate,
} from '@/lib/ipc'
import { isMac, isTauri } from '@/lib/platform'
import { useHosts } from '@/stores/hosts'
import { useUi } from '@/stores/ui'
import { DEFAULT_PORT, rdpClientName } from './lib'

type AuthType = 'password' | 'key'

interface Form {
  protocol: Protocol
  label: string
  hostname: string
  port: string
  username: string
  authType: AuthType
  keyPath: string
  password: string
  passphrase: string
  clearPassword: boolean
  clearPassphrase: boolean
  group: string
  tags: string
  color: HostColor
  icon: string | null
  notes: string
  favorite: boolean
}

function initialForm(host: Host | null, draft: Partial<Host> | null): Form {
  const src = host ?? draft ?? {}
  const protocol = src.protocol ?? 'ssh'
  return {
    protocol,
    label: src.label ?? '',
    hostname: src.hostname ?? '',
    port: String(src.port ?? DEFAULT_PORT[protocol]),
    username: src.username ?? '',
    authType: src.auth?.type ?? 'password',
    keyPath: src.auth?.type === 'key' ? src.auth.keyPath : '',
    password: '',
    passphrase: '',
    clearPassword: false,
    clearPassphrase: false,
    group: src.group ?? '',
    tags: (src.tags ?? []).join(', '),
    color: src.color ?? 'honey',
    icon: src.icon ?? null,
    notes: src.notes ?? '',
    favorite: src.favorite ?? false,
  }
}

type Errors = Partial<Record<'hostname' | 'port' | 'username' | 'keyPath' | 'group', string>>

function validate(f: Form): Errors {
  const e: Errors = {}
  if (!f.hostname.trim()) e.hostname = 'Enter a hostname or IP address.'
  else if (/\s/.test(f.hostname.trim())) e.hostname = 'The hostname can’t contain spaces.'
  const port = Number(f.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = '1–65535'
  if (!f.username.trim()) e.username = 'Enter the username to log in as.'
  if (f.authType === 'key' && !f.keyPath.trim()) e.keyPath = 'Choose a private key file.'
  if (f.group.split('/').some((part) => f.group.trim() && !part.trim()))
    e.group = 'Folder names can’t be empty. Use / between folders.'
  return e
}

const keychainName = isMac ? 'macOS Keychain' : 'Windows Credential Manager'

const PROTOCOL_CHOICES = [
  ['ssh', 'SSH', SquareTerminal, 'Terminal in a tab'],
  ['sftp', 'SFTP', FolderSync, 'Browse and transfer files'],
  ['rdp', 'Remote Desktop', Monitor, `Windows desktop in ${rdpClientName}`],
] as const

const AUTH_TYPES = [
  ['password', 'Password', LockKeyhole, 'Asked once, kept in your keychain'],
  ['key', 'Private key', KeyRound, 'An OpenSSH key file, e.g. id_ed25519'],
] as const

/** Initials or one of HOST_ICONS, previewed in the host's color. */
function IconPicker({
  value,
  onChange,
  label,
  color,
  protocol,
}: {
  value: string | null
  onChange: (icon: string | null) => void
  label: string
  color: HostColor
  protocol: Protocol
}) {
  const fill = HOST_COLORS[color].fill
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Host icon">
      {[null, ...HOST_ICON_KEYS].map((key) => {
        const Icon = key ? HOST_ICONS[key].Icon : CaseSensitive
        const on = value === key
        return (
          <button
            key={key ?? 'initials'}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={key ? HOST_ICONS[key].label : 'Initials'}
            title={key ? HOST_ICONS[key].label : `Initials (${label.slice(0, 2).toUpperCase()})`}
            onClick={() => onChange(key)}
            className={cn(
              'grid size-8 place-items-center rounded-lg border transition-[background-color,border-color,scale] duration-150 hover:scale-110 [&_svg]:size-4',
              on
                ? 'border-transparent'
                : 'border-line text-muted hover:border-line-strong hover:text-fg',
            )}
            style={on ? { background: fill, color: HOST_COLORS[color].text } : undefined}
          >
            <Icon />
          </button>
        )
      })}
      <span className="ml-1 self-center text-xs text-subtle">
        The {PROTOCOLS[protocol].label} badge always shows in the corner.
      </span>
    </div>
  )
}

/** A row of radio cards (icon, title, one-line description). */
function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string, typeof Monitor, string])[]
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn('grid gap-2', options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}
      >
        {options.map(([id, title, Icon, sub]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            onClick={() => onChange(id)}
            className={cn(
              'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
              value === id
                ? 'border-honey/60 bg-honey-soft'
                : 'border-line hover:border-line-strong hover:bg-surface-2',
            )}
          >
            <Icon className={cn('mt-0.5 size-4', value === id ? 'text-honey' : 'text-subtle')} />
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-subtle">{sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Global add/edit dialog, driven by `useUi().editing`. */
export function HostEditor() {
  const editing = useUi((s) => s.editing)
  const draft = useUi((s) => s.draft)
  const seq = useUi((s) => s.editorSeq)
  const editHost = useUi((s) => s.editHost)
  // Keep showing the last host while the dialog animates out; Radix unmounts it after.
  const [shown, setShown] = useState(editing)
  if (editing !== null && editing !== shown) setShown(editing)
  const host = shown && shown !== 'new' ? shown : null

  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && editHost(null)}>
      {shown !== null && (
        <EditorBody key={seq} host={host} draft={draft} onDone={() => editHost(null)} />
      )}
    </Dialog>
  )
}

function EditorBody({
  host,
  draft,
  onDone,
}: {
  host: Host | null
  draft: Partial<Host> | null
  onDone: () => void
}) {
  const save = useHosts((s) => s.save)
  const [f, setF] = useState<Form>(() => initialForm(host, draft))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [keySuggestions, setKeySuggestions] = useState<string[]>([])
  const errors = touched ? validate(f) : {}
  const groups = useHosts((s) => s.folders)

  useEffect(() => {
    void api.hosts
      .defaultKeyPaths()
      .then(setKeySuggestions)
      .catch(() => {})
  }, [])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }))

  // Follow the protocol's default port unless the user typed their own; RDP is password-only.
  const setProtocol = (protocol: Protocol) =>
    setF((prev) => ({
      ...prev,
      protocol,
      port:
        !prev.port || prev.port === String(DEFAULT_PORT[prev.protocol])
          ? String(DEFAULT_PORT[protocol])
          : prev.port,
      authType: protocol === 'rdp' ? 'password' : prev.authType,
    }))
  const isRdp = f.protocol === 'rdp'
  // macOS's Windows App can't be handed a password; it asks and keeps its own copy.
  const rdpAsksItself = isRdp && isMac

  const browseKey = async () => {
    if (!isTauri) return
    const picked = await openFileDialog({
      title: 'Choose a private key',
      multiple: false,
      directory: false,
    })
    if (typeof picked === 'string') set('keyPath', picked)
  }

  const secretUpdate = (value: string, clear: boolean): SecretUpdate =>
    value ? { action: 'set', value } : clear ? { action: 'clear' } : { action: 'keep' }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (Object.keys(validate(f)).length) return
    setSaving(true)
    const input: HostInput = {
      id: host?.id,
      protocol: f.protocol,
      label: f.label,
      hostname: f.hostname,
      port: Number(f.port),
      username: f.username,
      auth: f.authType === 'key' ? { type: 'key', keyPath: f.keyPath } : { type: 'password' },
      group: f.group || null,
      tags: f.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      color: f.color,
      icon: f.icon,
      notes: f.notes || null,
      favorite: f.favorite,
      password:
        f.authType === 'password' && !rdpAsksItself
          ? secretUpdate(f.password, f.clearPassword)
          : { action: 'keep' },
      passphrase:
        f.authType === 'key' ? secretUpdate(f.passphrase, f.clearPassphrase) : { action: 'keep' },
    }
    try {
      const saved = await save(input)
      toast.success(host ? `Saved “${saved.label}”` : `Added “${saved.label}” to the hive`)
      onDone()
    } catch (err) {
      toast.error('Couldn’t save the host', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const preview = f.label || f.hostname || 'New host'

  return (
    <DialogContent
      title={host ? `Edit ${host.label}` : 'New host'}
      description={
        host ? 'Changes apply to new sessions.' : 'Save a server so you can reach it in one click.'
      }
      icon={<Server />}
      className="w-[min(620px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="honey" type="submit" form="host-form" disabled={saving}>
            {saving ? 'Saving…' : host ? 'Save changes' : 'Add host'}
          </Button>
        </>
      }
    >
      <form id="host-form" onSubmit={submit} className="space-y-5" noValidate>
        {/* Identity */}
        <div className="flex items-center gap-4 rounded-xl border border-line bg-surface-2/50 p-3">
          <HexAvatar
            label={preview}
            color={f.color}
            icon={f.icon}
            protocol={f.protocol}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <Field label="Name">
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  value={f.label}
                  onChange={(e) => set('label', e.target.value)}
                  placeholder={f.hostname || 'e.g. prod-api-01'}
                />
              )}
            </Field>
          </div>
          <button
            type="button"
            aria-pressed={f.favorite}
            aria-label="Favorite"
            onClick={() => set('favorite', !f.favorite)}
            className={cn(
              'mt-5 grid size-9 place-items-center rounded-lg border border-line transition-colors',
              f.favorite ? 'border-honey/50 bg-honey-soft text-honey' : 'text-subtle hover:text-fg',
            )}
          >
            <Star className="size-4" fill={f.favorite ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Connection */}
        <ChoiceGroup
          label="Connect with"
          value={f.protocol}
          onChange={setProtocol}
          options={PROTOCOL_CHOICES}
        />
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Hostname or IP" error={errors.hostname}>
            {(p) => (
              <Input
                {...p}
                value={f.hostname}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="server.example.com"
                className="font-mono"
              />
            )}
          </Field>
          <Field label="Port" error={errors.port}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={f.port}
                onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))}
                className="font-mono"
              />
            )}
          </Field>
        </div>
        <Field
          label="Username"
          error={errors.username}
          hint={isRdp ? 'For a domain account use DOMAIN\\user or user@domain.' : undefined}
        >
          {(p) => (
            <Input
              {...p}
              value={f.username}
              onChange={(e) => set('username', e.target.value)}
              placeholder={isRdp ? 'Administrator' : 'ubuntu'}
              className="font-mono"
            />
          )}
        </Field>

        {/* Auth */}
        {!isRdp && (
          <ChoiceGroup
            label="Sign in with"
            value={f.authType}
            onChange={(v) => set('authType', v)}
            options={AUTH_TYPES}
          />
        )}

        {rdpAsksItself ? (
          <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2/50 p-3 text-xs text-muted">
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-subtle" />
            Windows App asks for the password the first time you connect and can keep it in your
            macOS Keychain.
          </p>
        ) : f.authType === 'password' ? (
          <SecretField
            label="Password"
            saved={!!host?.savedSecrets.password && !f.clearPassword}
            value={f.password}
            onChange={(v) => set('password', v)}
            onClear={() => set('clearPassword', true)}
            emptyHint={
              isRdp
                ? 'Leave empty and Remote Desktop will ask.'
                : 'Leave empty to be asked when you connect.'
            }
          />
        ) : (
          <>
            <Field
              label="Private key file"
              error={errors.keyPath}
              hint={
                keySuggestions.length > 0 && !f.keyPath
                  ? undefined
                  : 'OpenSSH format. ~ means your home folder.'
              }
            >
              {(p) => (
                <div className="flex gap-2">
                  <Input
                    {...p}
                    value={f.keyPath}
                    onChange={(e) => set('keyPath', e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                    className="font-mono"
                  />
                  {isTauri && (
                    <Button
                      variant="outline"
                      onClick={browseKey}
                      aria-label="Browse for a key file"
                    >
                      <FolderOpen /> Browse
                    </Button>
                  )}
                </div>
              )}
            </Field>
            {keySuggestions.length > 0 && !f.keyPath && (
              <div className="-mt-3 flex flex-wrap gap-1.5">
                <span className="text-xs text-subtle">Found:</span>
                {keySuggestions.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => set('keyPath', k)}
                    className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted hover:border-honey/50 hover:text-fg"
                  >
                    {k.split(/[\\/]/).pop()}
                  </button>
                ))}
              </div>
            )}
            <SecretField
              label="Key passphrase (optional)"
              saved={!!host?.savedSecrets.passphrase && !f.clearPassphrase}
              value={f.passphrase}
              onChange={(v) => set('passphrase', v)}
              onClear={() => set('clearPassphrase', true)}
              emptyHint="Only needed if your key is protected."
            />
          </>
        )}

        {/* Organize */}
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-5">
          <Field
            label="Folder"
            hint="Use / for subfolders, e.g. Production/EU"
            error={errors.group}
          >
            {(p) => (
              <>
                <Input
                  {...p}
                  list="host-groups"
                  value={f.group}
                  onChange={(e) => set('group', e.target.value)}
                  placeholder="Top level"
                />
                <datalist id="host-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Tags" hint="Comma separated">
            {(p) => (
              <Input
                {...p}
                value={f.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder="ubuntu, nginx"
              />
            )}
          </Field>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Icon</div>
          <IconPicker
            value={f.icon}
            onChange={(icon) => set('icon', icon)}
            label={preview}
            color={f.color}
            protocol={f.protocol}
          />
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Color</div>
          <div className="flex gap-2" role="radiogroup" aria-label="Host color">
            {HOST_COLOR_KEYS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={f.color === c}
                aria-label={HOST_COLORS[c].name}
                title={HOST_COLORS[c].name}
                onClick={() => set('color', c)}
                className={cn(
                  'hex-clip size-8 transition-transform hover:scale-110',
                  f.color === c && 'scale-110 ring-0 outline-none',
                )}
                style={{
                  background: HOST_COLORS[c].fill,
                  boxShadow: f.color === c ? 'inset 0 0 0 3px rgba(0,0,0,0.35)' : undefined,
                }}
              />
            ))}
          </div>
        </div>
        <Field label="Notes">
          {(p) => (
            <Textarea
              {...p}
              value={f.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Anything worth remembering about this box"
            />
          )}
        </Field>
      </form>
    </DialogContent>
  )
}

function SecretField({
  label,
  saved,
  value,
  onChange,
  onClear,
  emptyHint,
}: {
  label: string
  saved: boolean
  value: string
  onChange: (v: string) => void
  onClear: () => void
  emptyHint: string
}) {
  return (
    <Field
      label={label}
      hint={
        saved
          ? `Saved in the ${keychainName}. Type a new one to replace it.`
          : `${emptyHint} Stored only in the ${keychainName}.`
      }
    >
      {(p) => (
        <div className="flex gap-2">
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={saved ? '•••••••• (saved)' : ''}
          />
          {saved && !value && (
            <Button variant="outline" onClick={onClear}>
              Forget
            </Button>
          )}
        </div>
      )}
    </Field>
  )
}
