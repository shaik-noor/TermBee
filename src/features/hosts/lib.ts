import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { type AppError, api, type Host, type Protocol } from '@/lib/ipc'
import { isMac, isTauri } from '@/lib/platform'
import { refreshHosts } from '@/stores/hosts'
import { type TabKind, targetFromHost, useSessions } from '@/stores/sessions'

export const DEFAULT_PORT: Record<Protocol, number> = { ssh: 22, sftp: 22, rdp: 3389 }

/** The OS app an RDP host opens in. */
export const rdpClientName = isMac ? 'Windows App' : 'Remote Desktop'
const WINDOWS_APP_STORE_URL = 'https://apps.apple.com/app/windows-app/id1295203466'

export const UNGROUPED = 'Ungrouped'

export function matchesQuery(h: Host, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return [h.label, h.hostname, h.username, h.protocol, h.group ?? '', ...h.tags].some((v) =>
    v.toLowerCase().includes(needle),
  )
}

/** Drag-and-drop order within a folder, then A→Z. */
export const byOrder = (a: Host, b: Host) => a.order - b.order || a.label.localeCompare(b.label)

/** A folder path for display: `Production/EU` → `Production / EU`. */
export const folderTitle = (path: string) => path.split('/').join(' / ')

/** Hosts grouped by folder path, folders A→Z with "Ungrouped" last, in folder order within. */
export function groupHosts(hosts: Host[]): [string, Host[]][] {
  const map = new Map<string, Host[]>()
  for (const h of hosts) {
    const g = h.group || UNGROUPED
    map.set(g, [...(map.get(g) ?? []), h])
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)))
    .map(([g, list]) => [g, [...list].sort(byOrder)])
}

export function recentHosts(hosts: Host[], n = 4): Host[] {
  return hosts
    .filter((h) => h.lastConnectedAt)
    .sort((a, b) => (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? ''))
    .slice(0, n)
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function relativeTime(iso: string | null): string {
  if (!iso) return 'Never connected'
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'Just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return new Date(iso).toLocaleDateString()
}

export function address(h: {
  username: string
  hostname: string
  port: number
  protocol?: Protocol
}): string {
  const port = h.port !== DEFAULT_PORT[h.protocol ?? 'ssh'] ? `:${h.port}` : ''
  return `${h.username}@${h.hostname}${port}`
}

/** Connect to a saved host the way its protocol says: terminal tab, files tab, or RDP client. */
export function connectHost(host: Host) {
  if (host.protocol === 'rdp') void openRemoteDesktop(host)
  else
    useSessions
      .getState()
      .open(targetFromHost(host), host.protocol === 'sftp' ? 'files' : 'terminal')
}

/** SSH and SFTP hosts can open either kind of tab; switches to an open one first. */
export function openHostAs(host: Host, kind: TabKind) {
  useSessions.getState().openOrFocus(targetFromHost(host), kind)
}

async function openRemoteDesktop(host: Host) {
  const id = toast.loading(`Opening ${host.label} in ${rdpClientName}…`)
  try {
    await api.rdp.open(host.id)
    toast.success(`${host.label} opened in ${rdpClientName}`, {
      id,
      description: 'The desktop is in its own window.',
    })
    void refreshHosts()
  } catch (e) {
    const err = e as AppError
    toast.error(`Couldn’t open ${host.label}`, {
      id,
      description: err.message,
      action:
        err.kind === 'clientMissing' && isMac && isTauri
          ? { label: 'Get Windows App', onClick: () => void openUrl(WINDOWS_APP_STORE_URL) }
          : undefined,
    })
  }
}

/** Live session count per host id. */
export function useLiveCounts(): Record<string, number> {
  return useSessions(
    useShallow((s) => {
      const counts: Record<string, number> = {}
      for (const t of s.tabs) {
        if (t.target.hostId && t.status === 'connected')
          counts[t.target.hostId] = (counts[t.target.hostId] ?? 0) + 1
      }
      return counts
    }),
  )
}

export interface FolderNode {
  path: string
  name: string
  folders: FolderNode[]
  hosts: Host[]
  /** Hosts in this folder and every folder below it. */
  count: number
}

/** The sidebar tree: folders (A→Z) then hosts (drag order) at every level. */
export function buildTree(folders: string[], hosts: Host[]): FolderNode {
  const root: FolderNode = { path: '', name: '', folders: [], hosts: [], count: 0 }
  const nodes = new Map<string, FolderNode>([['', root]])
  const node = (path: string): FolderNode => {
    const found = nodes.get(path)
    if (found) return found
    const cut = path.lastIndexOf('/')
    const created: FolderNode = {
      path,
      name: path.slice(cut + 1),
      folders: [],
      hosts: [],
      count: 0,
    }
    nodes.set(path, created)
    node(cut < 0 ? '' : path.slice(0, cut)).folders.push(created)
    return created
  }
  for (const f of folders) node(f)
  for (const h of hosts) node(h.group ?? '').hosts.push(h)
  const finish = (n: FolderNode): number => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name))
    n.hosts.sort(byOrder)
    n.count = n.hosts.length + n.folders.reduce((sum, f) => sum + finish(f), 0)
    return n.count
  }
  finish(root)
  return root
}

/** `Production/EU` → `EU`; `Production` → `Production`. */
export const folderName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const folderParent = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
