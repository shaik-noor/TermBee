/**
 * In-memory file trees for the browser mock (`dev:web`): one POSIX "server" and one
 * Windows-style "This PC", so both panes of a files tab can be exercised without Tauri.
 */
import type { FileEntry, Place, TransferProgress } from './types'

interface Node {
  kind: 'file' | 'dir'
  size: number
  mtime: number
  text?: string
}

const enc = new TextEncoder()
const nowSecs = () => Math.floor(Date.now() / 1000)
const err = (kind: string, message: string) => ({ kind, message })

export class MemFs {
  private nodes = new Map<string, Node>()
  constructor(
    readonly sep: '/' | '\\',
    private root: string,
  ) {
    this.nodes.set(root, { kind: 'dir', size: 0, mtime: nowSecs() })
  }

  join = (dir: string, name: string) =>
    dir.endsWith(this.sep) ? dir + name : dir + this.sep + name
  parent = (p: string) => {
    if (p === this.root) return null
    const cut = p.lastIndexOf(this.sep)
    const up = p.slice(0, cut)
    return up.length < this.root.length ? this.root : up || this.root
  }
  name = (p: string) => p.slice(p.lastIndexOf(this.sep) + 1)

  /** Seeds `path` (and its parents) with a file of `size` bytes or `text`. */
  add(path: string, kind: 'file' | 'dir', size = 0, text?: string) {
    const up = this.parent(path)
    if (up && !this.nodes.has(up)) this.add(up, 'dir')
    const mtime = nowSecs() - Math.floor(Math.random() * 90 * 86400)
    this.nodes.set(path, { kind, size: text ? enc.encode(text).length : size, mtime, text })
  }

  private under = (p: string) =>
    [...this.nodes.keys()].filter((k) => k === p || k.startsWith(p + this.sep))

  list(dir: string): FileEntry[] {
    if (this.nodes.get(dir)?.kind !== 'dir') throw err('notFound', `${dir} doesn't exist.`)
    return [...this.nodes.entries()]
      .filter(([p]) => p !== dir && this.parent(p) === dir)
      .map(([p, n]) => ({
        name: this.name(p),
        path: p,
        kind: n.kind,
        link: false,
        hidden: this.name(p).startsWith('.'),
        size: n.size,
        modified: n.mtime,
        permissions: this.sep === '/' ? (n.kind === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--') : null,
      }))
  }

  mkdir(path: string) {
    if (this.nodes.has(path)) throw err('invalid', `${path} already exists.`)
    this.nodes.set(path, { kind: 'dir', size: 0, mtime: nowSecs() })
  }

  rename(from: string, to: string) {
    if (this.nodes.has(to)) throw err('invalid', `${to} already exists.`)
    for (const p of this.under(from)) {
      this.nodes.set(to + p.slice(from.length), this.nodes.get(p) as Node)
      this.nodes.delete(p)
    }
  }

  remove(path: string) {
    for (const p of this.under(path)) this.nodes.delete(p)
  }

  /** Every file under `path` (or `path` itself), with sizes. */
  files(path: string): [string, Node][] {
    return this.under(path)
      .map((p) => [p, this.nodes.get(p) as Node] as [string, Node])
      .filter(([, n]) => n.kind === 'file')
  }

  /** Copies `from` (file or folder) in `src` to `to` in this tree. */
  copyFrom(src: MemFs, from: string, to: string) {
    for (const p of src.under(from)) {
      const rel = p.slice(from.length).split(src.sep).join(this.sep)
      const n = src.nodes.get(p) as Node
      this.nodes.set(to + rel, { ...n, mtime: nowSecs() })
    }
  }

  read(path: string, max: number): ArrayBuffer {
    const n = this.nodes.get(path)
    if (n?.kind !== 'file') throw err('notFound', `${path} doesn't exist.`)
    const bytes = enc.encode(n.text ?? `Preview of ${this.name(path)} (${n.size} bytes, mock).\n`)
    return bytes.slice(0, max).buffer
  }

  write(path: string, text: string) {
    this.nodes.set(path, { kind: 'file', size: enc.encode(text).length, mtime: nowSecs(), text })
  }

  exists = (p: string) => this.nodes.has(p)
  isDir = (p: string) => this.nodes.get(p)?.kind === 'dir'
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const running = new Set<string>()

/** Fake progress for a transfer of `files`, honoring cancel. */
export async function fakeProgress(
  id: string,
  files: [string, { size: number }][],
  onProgress: (p: TransferProgress) => void,
) {
  running.add(id)
  const total = files.reduce((s, [, n]) => s + n.size, 0)
  let done = 0
  for (const [i, [path, n]] of files.entries()) {
    const steps = Math.max(2, Math.min(10, Math.ceil(n.size / 400_000)))
    for (let s = 1; s <= steps; s++) {
      await delay(70)
      if (!running.has(id)) throw err('cancelled', 'Cancelled.')
      onProgress({
        done: done + Math.round((n.size * s) / steps),
        total,
        filesDone: i,
        filesTotal: files.length,
        current: path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1),
      })
    }
    done += n.size
  }
  onProgress({ done, total, filesDone: files.length, filesTotal: files.length, current: null })
  running.delete(id)
}
export const cancelFake = (id: string) => running.delete(id)

// --- seeds

export const remoteFs = new MemFs('/', '/')
for (const [p, k, size] of [
  ['/etc/hosts', 'file', 220],
  ['/var/log/syslog', 'file', 1_482_113],
  ['/var/www/app/index.html', 'file', 2_310],
  ['/home/bee/.bashrc', 'file', 3_771],
  ['/home/bee/.ssh/authorized_keys', 'file', 742],
  ['/home/bee/backup-2026-11-01.tar.gz', 'file', 734_003_200],
  ['/home/bee/logs/app.log', 'file', 88_211],
  ['/home/bee/logs/error.log', 'file', 4_502],
  ['/home/bee/projects/termbee/README.md', 'file', 0],
] as const)
  remoteFs.add(p, k, size)
remoteFs.add(
  '/home/bee/notes.md',
  'file',
  0,
  '# Notes\n\n- Rotate the API keys on Friday\n- `deploy.sh` needs the new env vars\n',
)
remoteFs.add(
  '/home/bee/deploy.sh',
  'file',
  0,
  '#!/usr/bin/env bash\nset -euo pipefail\n\ngit pull --ff-only\nnpm ci && npm run build\nsudo systemctl restart app\n',
)
remoteFs.add(
  '/home/bee/logo.svg',
  'file',
  0,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><polygon points="32,4 58,18 58,46 32,60 6,46 6,18" fill="#F9B21A"/><text x="32" y="40" font-size="20" text-anchor="middle" fill="#1C1408" font-family="monospace">&gt;_</text></svg>',
)

export const localFs = new MemFs('\\', 'C:\\')
const home = 'C:\\Users\\you'
for (const [p, k, size] of [
  [`${home}\\Desktop\\todo.txt`, 'file', 512],
  [`${home}\\Documents\\invoice-0425.pdf`, 'file', 84_201],
  [`${home}\\Downloads\\termbee-setup.exe`, 'file', 6_204_112],
  [`${home}\\Downloads\\photos`, 'dir', 0],
  [`${home}\\Downloads\\photos\\hive.jpg`, 'file', 1_204_000],
  [`${home}\\projects\\api\\server.ts`, 'file', 4_210],
  [`${home}\\projects\\api\\package.json`, 'file', 902],
  [`${home}\\.gitconfig`, 'file', 210],
] as const)
  localFs.add(p, k, size)

export const localPlaces: Place[] = [
  { label: 'Home', path: home, kind: 'home' },
  { label: 'Desktop', path: `${home}\\Desktop`, kind: 'desktop' },
  { label: 'Documents', path: `${home}\\Documents`, kind: 'documents' },
  { label: 'Downloads', path: `${home}\\Downloads`, kind: 'downloads' },
  { label: 'C:', path: 'C:\\', kind: 'drive' },
]
