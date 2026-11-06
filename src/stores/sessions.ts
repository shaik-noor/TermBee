import { create } from 'zustand'
import type { AuthMethod, Host, HostColor, SessionPhase } from '@/lib/ipc'

/** What a tab connects to — a saved host, or an ad-hoc `user@host` from quick connect. */
export interface Target {
  hostId: string | null
  label: string
  hostname: string
  port: number
  username: string
  auth: AuthMethod
  color: HostColor
  icon: string | null
}

/** A terminal (SSH shell) or a files browser (SFTP) over the same login. */
export type TabKind = 'terminal' | 'files'

export type TabStatus = SessionPhase | 'idle' | 'closed' | 'error'

export interface Tab {
  id: string
  kind: TabKind
  target: Target
  status: TabStatus
  /** Bumped to make the tab reconnect. */
  attempt: number
}

export const HOME = 'home'

const sameTarget = (a: Target, b: Target) =>
  a.hostId && b.hostId
    ? a.hostId === b.hostId
    : a.hostname === b.hostname && a.port === b.port && a.username === b.username

interface SessionsState {
  tabs: Tab[]
  activeId: string
  open: (target: Target, kind?: TabKind) => string
  /** Switches to this host's tab of that kind if one is open, else opens one. */
  openOrFocus: (target: Target, kind: TabKind) => string
  close: (id: string) => void
  activate: (id: string) => void
  cycle: (dir: 1 | -1) => void
  setStatus: (id: string, status: TabStatus) => void
  reconnect: (id: string) => void
  duplicate: (id: string) => void
}

export const useSessions = create<SessionsState>((set, get) => ({
  tabs: [],
  activeId: HOME,

  open: (target, kind = 'terminal') => {
    const id = crypto.randomUUID()
    set({ tabs: [...get().tabs, { id, kind, target, status: 'idle', attempt: 0 }], activeId: id })
    return id
  },

  openOrFocus: (target, kind) => {
    const existing = get().tabs.find((t) => t.kind === kind && sameTarget(t.target, target))
    if (!existing) return get().open(target, kind)
    set({ activeId: existing.id })
    return existing.id
  },

  close: (id) => {
    const { tabs, activeId } = get()
    const index = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    let nextActive = activeId
    if (activeId === id) nextActive = next[Math.min(index, next.length - 1)]?.id ?? HOME
    set({ tabs: next, activeId: nextActive })
  },

  activate: (id) => set({ activeId: id }),

  cycle: (dir) => {
    const ids = [HOME, ...get().tabs.map((t) => t.id)]
    const i = ids.indexOf(get().activeId)
    set({ activeId: ids[(i + dir + ids.length) % ids.length] })
  },

  setStatus: (id, status) =>
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, status } : t)) }),

  reconnect: (id) =>
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, attempt: t.attempt + 1 } : t)) }),

  duplicate: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (tab) get().open(tab.target, tab.kind)
  },
}))

export function targetFromHost(host: Host): Target {
  return {
    hostId: host.id,
    label: host.label,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    auth: host.auth,
    color: host.color,
    icon: host.icon,
  }
}

/** Parses `user@host[:port]` (as typed into quick connect). */
export function parseQuickTarget(input: string): Target | null {
  const m = input.trim().match(/^(?:ssh\s+|sftp\s+)?([^@\s]+)@([^\s:]+)(?::(\d{1,5}))?$/)
  if (!m) return null
  const port = m[3] ? Number(m[3]) : 22
  if (port < 1 || port > 65535) return null
  return {
    hostId: null,
    label: m[2],
    hostname: m[2],
    port,
    username: m[1],
    auth: { type: 'password' },
    color: 'honey',
    icon: null,
  }
}

/** `sftp user@host` in quick connect opens a files tab. */
export const quickKind = (input: string): TabKind =>
  /^\s*sftp\s/i.test(input) ? 'files' : 'terminal'

export const isLive = (s: TabStatus) =>
  s === 'connecting' || s === 'handshake' || s === 'authenticating' || s === 'connected'
