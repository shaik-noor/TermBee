import { toast } from 'sonner'
import { create } from 'zustand'
import { api, type Hive, type Host, type HostInput } from '@/lib/ipc'

interface HostsState {
  hosts: Host[]
  /** Every folder path, A→Z (parents before children), including empty folders. */
  folders: string[]
  loaded: boolean
  load: () => Promise<void>
  save: (input: HostInput) => Promise<Host>
  remove: (id: string) => Promise<void>
  toggleFavorite: (host: Host) => Promise<void>
  /** Drag-and-drop: into `folder` (null = top level), before `before` or at the end. */
  moveHosts: (ids: string[], folder: string | null, before: string | null) => Promise<void>
  createFolder: (path: string) => Promise<void>
  /** Rename (same parent) or move (new parent) a folder with everything inside. */
  moveFolder: (from: string, to: string) => Promise<void>
  /** Hosts and subfolders move up a level. */
  removeFolder: (path: string) => Promise<void>
}

/** Reorganize actions report failures as toasts; the store keeps the core's last answer. */
async function apply(set: (s: Partial<HostsState>) => void, op: () => Promise<Hive>) {
  try {
    const hive = await op()
    set({ hosts: hive.hosts, folders: hive.folders })
  } catch (e) {
    toast.error('Couldn’t reorganize', { description: (e as Error).message })
    throw e
  }
}

export const useHosts = create<HostsState>((set, get) => ({
  hosts: [],
  folders: [],
  loaded: false,

  load: async () => {
    try {
      const hive = await api.hosts.hive()
      set({ hosts: hive.hosts, folders: hive.folders, loaded: true })
    } catch (e) {
      set({ loaded: true })
      toast.error('Couldn’t load your hosts', { description: (e as Error).message })
    }
  },

  save: async (input) => {
    const host = await api.hosts.save(input)
    const exists = get().hosts.some((h) => h.id === host.id)
    set({
      hosts: exists
        ? get().hosts.map((h) => (h.id === host.id ? host : h))
        : [...get().hosts, host],
    })
    // The host may have named a new folder.
    if (host.group && !get().folders.includes(host.group)) void get().load()
    return host
  },

  remove: async (id) => {
    await api.hosts.remove(id)
    set({ hosts: get().hosts.filter((h) => h.id !== id) })
  },

  toggleFavorite: async (host) => {
    await get().save({ ...host, favorite: !host.favorite })
  },

  moveHosts: (ids, folder, before) => apply(set, () => api.hosts.move(ids, folder, before)),
  createFolder: (path) => apply(set, () => api.folders.create(path)),
  moveFolder: (from, to) => apply(set, () => api.folders.move(from, to)),
  removeFolder: (path) => apply(set, () => api.folders.remove(path)),
}))

/** Re-read hosts (e.g. after a login recorded `lastConnectedAt` / a remembered secret). */
export const refreshHosts = () => useHosts.getState().load()

export function hostToInput(host: Host): HostInput {
  const {
    savedSecrets: _s,
    createdAt: _c,
    updatedAt: _u,
    lastConnectedAt: _l,
    order: _o,
    ...rest
  } = host
  return rest
}
