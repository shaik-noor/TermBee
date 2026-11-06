/**
 * Browser-only stand-in for the Rust core so `npm run dev:web` can render the whole UI.
 * Hosts and folders persist to localStorage; SSH sessions are a tiny fake shell, and files
 * tabs use the in-memory trees in mockfs.ts. Folder logic mirrors src-tauri/src/hosts/folders.rs. Never used
 * in Tauri.
 */
import { cancelFake, fakeProgress, localFs, localPlaces, remoteFs } from './mockfs'
import type {
  DownloadTarget,
  Hive,
  Host,
  HostInput,
  KnownHost,
  SessionEvent,
  TransferProgress,
} from './types'

type Progress = (p: TransferProgress) => void

const KEY = 'termbee:mock:hosts'
const FOLDERS_KEY = 'termbee:mock:folders'
const now = () => new Date().toISOString()

const seed: Host[] = [
  mk('prod-api-01', '10.20.4.11', 'deploy', 'Production', 'honey', true, ['api', 'ubuntu']),
  {
    ...mk('prod-db-01', 'db1.internal', 'postgres', 'Production/EU', 'rose', false, ['postgres']),
    icon: 'database',
  },
  mk('staging-web', 'staging.example.com', 'ubuntu', 'Staging', 'clover', true, ['nginx']),
  {
    ...mk('build-agent', '192.168.1.40', 'ci', 'Lab', 'sky', false, ['ci', 'docker']),
    icon: 'cpu',
  },
  mk('pi-garden', 'raspberrypi.local', 'pi', 'Lab', 'lilac', false, []),
  {
    ...mk('backups', 'nas.local', 'bee', 'Lab', 'amber', false, ['nas']),
    protocol: 'sftp',
    icon: 'hard-drive',
  },
  {
    ...mk('win-jumpbox', 'jump.corp.example', 'CORP\\bee', 'Production', 'sky', false, ['windows']),
    protocol: 'rdp',
    port: 3389,
  },
]

function mk(
  label: string,
  hostname: string,
  username: string,
  group: string,
  color: Host['color'],
  favorite: boolean,
  tags: string[],
): Host {
  return {
    id: crypto.randomUUID(),
    protocol: 'ssh',
    label,
    hostname,
    port: 22,
    username,
    auth: favorite ? { type: 'key', keyPath: '~/.ssh/id_ed25519' } : { type: 'password' },
    group: group || null,
    order: 0,
    tags,
    color,
    icon: null,
    notes: null,
    favorite,
    savedSecrets: { password: !favorite, passphrase: false },
    createdAt: now(),
    updatedAt: now(),
    lastConnectedAt: favorite ? now() : null,
  }
}

function load(): Host[] {
  const raw = localStorage.getItem(KEY)
  if (!raw) {
    localStorage.setItem(KEY, JSON.stringify(seed))
    return seed
  }
  // Hosts saved by older builds lack newer fields, like serde's defaults in the core.
  return (JSON.parse(raw) as Host[]).map((h) => ({
    ...h,
    protocol: h.protocol ?? 'ssh',
    order: h.order ?? 0,
    icon: h.icon ?? null,
  }))
}

function persist(hosts: Host[]) {
  localStorage.setItem(KEY, JSON.stringify(hosts))
}

// --- folders (same rules as hosts/folders.rs)

const loadFolders = (): string[] => JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '[]')
const persistFolders = (f: string[]) => localStorage.setItem(FOLDERS_KEY, JSON.stringify(f))
const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`)
const parentOf = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
const rebase = (path: string, from: string, to: string | null) => {
  const rest = path.slice(from.length)
  return to !== null ? to + rest : rest ? rest.slice(1) : null
}

function normalize(path: string): string {
  const parts = path.split('/').map((p) => p.trim())
  if (parts.some((p) => !p)) throw { kind: 'invalid', message: 'Folder names can’t be empty.' }
  return parts.join('/')
}

function hive(): Hive {
  const hosts = load()
  const set = new Set<string>()
  const add = (p: string | null) => {
    for (let cur = p; cur; cur = parentOf(cur)) set.add(cur)
  }
  for (const f of loadFolders()) add(f)
  for (const h of hosts) add(h.group)
  return { hosts, folders: [...set].sort() }
}

function rewrite(change: (path: string) => string | null | undefined): Hive {
  persist(
    load().map((h) => {
      if (!h.group) return h
      const next = change(h.group)
      return next === undefined ? h : { ...h, group: next }
    }),
  )
  const folders = new Set<string>()
  for (const f of loadFolders()) {
    const next = change(f)
    if (next === undefined) folders.add(f)
    else if (next) folders.add(next)
  }
  persistFolders([...folders].sort())
  return hive()
}

function moveHosts(ids: string[], folder: string | null, before: string | null): Hive {
  const hosts = load().map((h) => (ids.includes(h.id) ? { ...h, group: folder } : h))
  const siblings = hosts
    .filter((h) => h.group === folder && !ids.includes(h.id))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  const moving = ids.map((id) => hosts.find((h) => h.id === id)).filter(Boolean) as Host[]
  const at = before ? siblings.findIndex((h) => h.id === before) : -1
  siblings.splice(at < 0 ? siblings.length : at, 0, ...moving)
  siblings.forEach((h, n) => {
    h.order = n
  })
  persist(hosts)
  return hive()
}

// --- commands

const sessions = new Map<string, (e: SessionEvent) => void>()
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function mockInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await delay(60)
  switch (cmd) {
    case 'hosts_list':
      return load() as T
    case 'hosts_hive':
      return hive() as T
    case 'hosts_save': {
      const input = args.input as HostInput
      const hosts = load()
      const existing = hosts.find((h) => h.id === input.id)
      const group = input.group ? normalize(input.group) : null
      const order =
        existing && existing.group === group
          ? existing.order
          : Math.max(-1, ...hosts.filter((h) => h.group === group).map((h) => h.order)) + 1
      const host: Host = {
        ...(existing ?? mk(input.label, input.hostname, input.username, '', 'honey', false, [])),
        ...input,
        id: existing?.id ?? crypto.randomUUID(),
        protocol: input.protocol ?? 'ssh',
        group,
        order,
        tags: input.tags ?? [],
        color: input.color ?? 'honey',
        icon: input.icon ?? null,
        notes: input.notes ?? null,
        favorite: input.favorite ?? false,
        savedSecrets: {
          password: input.password?.action === 'set' || !!existing?.savedSecrets.password,
          passphrase: input.passphrase?.action === 'set' || !!existing?.savedSecrets.passphrase,
        },
        updatedAt: now(),
      } as Host
      persist(existing ? hosts.map((h) => (h.id === host.id ? host : h)) : [...hosts, host])
      return host as T
    }
    case 'hosts_delete':
      persist(load().filter((h) => h.id !== args.id))
      return undefined as T
    case 'hosts_move':
      return moveHosts(
        args.ids as string[],
        (args.folder as string | null) ?? null,
        (args.before as string | null) ?? null,
      ) as T
    case 'folders_create': {
      const path = normalize(args.path as string)
      persistFolders([...new Set([...loadFolders(), path])].sort())
      return hive() as T
    }
    case 'folders_move': {
      const from = normalize(args.from as string)
      const to = normalize(args.to as string)
      if (from === to) return hive() as T
      if (within(to, from))
        throw { kind: 'invalid', message: 'A folder can’t be moved inside itself.' }
      if (hive().folders.includes(to))
        throw { kind: 'invalid', message: `There’s already a folder called “${to}”.` }
      return rewrite((p) => (within(p, from) ? rebase(p, from, to) : undefined)) as T
    }
    case 'folders_delete': {
      const path = normalize(args.path as string)
      const up = parentOf(path)
      return rewrite((p) => (within(p, path) ? rebase(p, path, up) : undefined)) as T
    }
    case 'ssh_default_key_paths':
      return ['~/.ssh/id_ed25519', '~/.ssh/id_rsa'] as T
    case 'known_hosts_list':
      return [] as KnownHost[] as T
    case 'known_hosts_forget':
      return undefined as T
    case 'rdp_open': {
      // No Remote Desktop client in a browser: just record the "login" like the core does.
      await delay(400)
      persist(load().map((h) => (h.id === args.hostId ? { ...h, lastConnectedAt: now() } : h)))
      return undefined as T
    }
    case 'ssh_connect':
      return startFakeSession(args) as T
    case 'ssh_write': {
      const emit = sessions.get(args.sessionId as string)
      const data = args.data as string
      emit?.({ type: 'data', data: data === '\r' ? '\r\n\x1b[38;5;214m❯\x1b[0m ' : data })
      return undefined as T
    }
    case 'ssh_close': {
      const emit = sessions.get(args.sessionId as string)
      emit?.({ type: 'closed', exitStatus: 0 })
      sessions.delete(args.sessionId as string)
      return undefined as T
    }
    // --- files tab: the server
    case 'sftp_home':
      return '/home/bee' as T
    case 'sftp_list':
      return remoteFs.list(args.path as string) as T
    case 'sftp_mkdir':
      remoteFs.mkdir(args.path as string)
      return undefined as T
    case 'sftp_rename':
      remoteFs.rename(args.from as string, args.to as string)
      return undefined as T
    case 'sftp_delete':
      remoteFs.remove(args.path as string)
      return undefined as T
    case 'sftp_read':
      return remoteFs.read(args.path as string, args.maxBytes as number) as T
    case 'sftp_write_text':
      remoteFs.write(args.path as string, args.text as string)
      return undefined as T
    case 'sftp_copy': {
      const [from, to] = [args.from as string, args.to as string]
      if (remoteFs.exists(to)) throw { kind: 'invalid', message: `${to} already exists.` }
      await fakeProgress(
        args.transferId as string,
        remoteFs.files(from),
        args.onProgress as Progress,
      )
      remoteFs.copyFrom(remoteFs, from, to)
      return undefined as T
    }
    case 'sftp_download': {
      const remote = args.remotePath as string
      const target = args.target as DownloadTarget
      const dest =
        target.type === 'file' ? target.path : localFs.join(target.dir, remoteFs.name(remote))
      await fakeProgress(
        args.transferId as string,
        remoteFs.files(remote),
        args.onProgress as Progress,
      )
      localFs.remove(dest)
      localFs.copyFrom(remoteFs, remote, dest)
      return dest as T
    }
    case 'sftp_upload': {
      const [local, remote] = [args.localPath as string, args.remotePath as string]
      // Browser file pickers only give names: treat unknown paths as small new files.
      if (!localFs.exists(local))
        localFs.add(local, 'file', 40_000 + Math.floor(Math.random() * 4e6))
      await fakeProgress(
        args.transferId as string,
        localFs.files(local),
        args.onProgress as Progress,
      )
      remoteFs.remove(remote)
      remoteFs.copyFrom(localFs, local, remote)
      return undefined as T
    }
    case 'sftp_cancel_transfer':
      cancelFake(args.transferId as string)
      return undefined as T
    // --- files tab: This PC
    case 'local_places':
      return localPlaces as T
    case 'local_list':
      return localFs.list(args.path as string) as T
    case 'local_mkdir':
      localFs.mkdir(args.path as string)
      return undefined as T
    case 'local_rename':
      localFs.rename(args.from as string, args.to as string)
      return undefined as T
    case 'local_copy': {
      const [from, to] = [args.from as string, args.to as string]
      if (localFs.exists(to)) throw { kind: 'invalid', message: `${to} already exists.` }
      localFs.copyFrom(localFs, from, to)
      return undefined as T
    }
    case 'local_trash':
      for (const path of args.paths as string[]) localFs.remove(path)
      return undefined as T
    case 'local_read':
      return localFs.read(args.path as string, args.maxBytes as number) as T
    case 'local_open':
    case 'local_reveal':
      return undefined as T
    default:
      return undefined as T
  }
}

function startFakeSession(args: Record<string, unknown>): string {
  const id = crypto.randomUUID()
  const emit = args.onEvent as (e: SessionEvent) => void
  const req = args.request as { username: string; hostname: string; mode?: string }
  sessions.set(id, emit)
  void (async () => {
    emit({ type: 'phase', phase: 'connecting' })
    await delay(350)
    emit({ type: 'phase', phase: 'authenticating' })
    await delay(350)
    emit({ type: 'phase', phase: 'connected' })
    if (req.mode === 'sftp') return
    emit({
      type: 'data',
      data:
        `\x1b[38;5;214m🐝 TermBee preview shell\x1b[0m — this is the browser mock, not a real server.\r\n\r\n` +
        `Last login: ${new Date().toUTCString()}\r\n` +
        `\x1b[1;32m${req.username}@${req.hostname}\x1b[0m:\x1b[1;34m~\x1b[0m\r\n\x1b[38;5;214m❯\x1b[0m `,
    })
  })()
  return id
}
