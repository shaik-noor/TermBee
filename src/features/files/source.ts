import { api, type FileEntry, type Place } from '@/lib/ipc'

export type Side = 'local' | 'remote'

/**
 * One side of a files tab. Both panes are the same component; this adapter is what differs:
 * the server over SFTP, or this computer. Path helpers follow the side's separator.
 */
export interface FileSource {
  side: Side
  sep: '/' | '\\'
  home: () => Promise<string>
  places: () => Promise<Place[]>
  list: (path: string) => Promise<FileEntry[]>
  mkdir: (path: string) => Promise<void>
  /** Rename, or move within the same side. */
  rename: (from: string, to: string) => Promise<void>
  /** Remote: deleted for good (after a confirm). Local: to the Recycle Bin / Trash. */
  remove: (entries: FileEntry[]) => Promise<void>
  read: (path: string, maxBytes: number) => Promise<ArrayBuffer>
}

export function remoteSource(sessionId: string): FileSource {
  return {
    side: 'remote',
    sep: '/',
    home: () => api.sftp.home(sessionId),
    places: async () => {
      const home = await api.sftp.home(sessionId)
      return [
        { label: 'Home', path: home, kind: 'home' },
        { label: 'Root', path: '/', kind: 'drive' },
      ]
    },
    list: (p) => api.sftp.list(sessionId, p),
    mkdir: (p) => api.sftp.mkdir(sessionId, p),
    rename: (a, b) => api.sftp.rename(sessionId, a, b),
    remove: async (entries) => {
      for (const e of entries) await api.sftp.remove(sessionId, e.path, e.kind === 'dir' && !e.link)
    },
    read: (p, max) => api.sftp.read(sessionId, p, max),
  }
}

/** Windows paths use `\`; macOS uses `/`. Decided from the home folder's path. */
export function localSource(sep: '/' | '\\'): FileSource {
  return {
    side: 'local',
    sep,
    home: async () => (await api.local.places()).find((p) => p.kind === 'home')?.path ?? '/',
    places: () => api.local.places(),
    list: (p) => api.local.list(p),
    mkdir: (p) => api.local.mkdir(p),
    rename: (a, b) => api.local.rename(a, b),
    remove: (entries) => api.local.trash(entries.map((e) => e.path)),
    read: (p, max) => api.local.read(p, max),
  }
}

// --- path helpers (sep-aware; Windows roots look like `C:\`)

const isRoot = (p: string, sep: string) =>
  sep === '/' ? p === '/' : /^[A-Za-z]:\\?$/.test(p) || p === '\\'

export const joinPath = (sep: string, dir: string, name: string) =>
  dir.endsWith(sep) ? dir + name : dir + sep + name

export function parentPath(sep: string, p: string): string | null {
  if (isRoot(p, sep)) return null
  const trimmed = p.endsWith(sep) ? p.slice(0, -1) : p
  const cut = trimmed.lastIndexOf(sep)
  if (cut < 0) return null
  const up = trimmed.slice(0, cut)
  if (sep === '/') return up || '/'
  return /^[A-Za-z]:$/.test(up) ? `${up}\\` : up
}

export const baseName = (p: string) => p.slice(p.replace(/[\\/]+$/, '').search(/[^\\/]*$/))

/** `/home/bee` → [['/', '/'], ['home', '/home'], ['bee', '/home/bee']]; `C:\Users` → [['C:', 'C:\'], …]. */
export function crumbs(sep: string, path: string): [string, string][] {
  const out: [string, string][] = []
  if (sep === '/') {
    out.push(['/', '/'])
    let acc = ''
    for (const part of path.split('/').filter(Boolean)) {
      acc += `/${part}`
      out.push([part, acc])
    }
    return out
  }
  const parts = path.split('\\').filter(Boolean)
  let acc = ''
  for (const [i, part] of parts.entries()) {
    acc = i === 0 ? `${part}\\` : joinPath('\\', acc, part)
    out.push([part, acc])
  }
  return out
}

/** `notes.md` → `notes copy.md`, then `notes copy 2.md`… for pasting next to the original. */
export function copyName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`
    if (!taken.has(candidate)) return candidate
  }
}
