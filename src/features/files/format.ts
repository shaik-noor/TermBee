import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  Folder,
  type LucideIcon,
} from 'lucide-react'
import type { FileEntry } from '@/lib/ipc'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  let n = bytes
  let u = 0
  while (n >= 1024 && u < UNITS.length - 1) {
    n /= 1024
    u++
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${UNITS[u]}`
}

export const formatSpeed = (bps: number) => (bps > 0 ? `${formatSize(bps)}/s` : '')

/** "38 s left", "4 min left", "1 h 12 min left". */
export function formatEta(remaining: number, bps: number): string {
  if (bps <= 0 || remaining <= 0) return ''
  const s = Math.ceil(remaining / bps)
  if (s < 60) return `${s} s left`
  if (s < 3600) return `${Math.round(s / 60)} min left`
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min left`
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
export const formatDate = (unix: number | null) => (unix ? dateFmt.format(unix * 1000) : '')

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
const TEXT =
  /(\.(txt|md|markdown|log|csv|tsv|json|ya?ml|toml|ini|conf|cfg|env|xml|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|rs|go|py|rb|php|java|kt|c|h|cpp|hpp|cs|sh|bash|zsh|fish|ps1|bat|sql|service|lock|gitignore|dockerignore)$)|(^(readme|license|makefile|dockerfile|\..*rc|\.?env.*|authorized_keys|known_hosts|config|hosts|crontab)$)/i

export const isImage = (name: string) => IMAGE.test(name)
export const looksTextual = (name: string) => TEXT.test(name)

const MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon',
}
export const imageMime = (name: string) => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return MIME[ext] ?? `image/${ext}`
}

const EXT: [RegExp, LucideIcon][] = [
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar|zst)$/i, FileArchive],
  [IMAGE, FileImage],
  [
    /\.(sh|bash|zsh|py|rb|js|ts|tsx|jsx|rs|go|java|c|h|cpp|json|ya?ml|toml|ini|conf|xml|html|css|sql)$/i,
    FileCode,
  ],
  [/(\.(txt|md|log|csv|pdf)$)|^(readme|license|\..*rc)$/i, FileText],
]

export function entryIcon(e: FileEntry): LucideIcon {
  if (e.kind === 'dir') return Folder
  return EXT.find(([re]) => re.test(e.name))?.[1] ?? File
}

/** A short type label for the Type column ("Folder", "MD file", "File"). */
export function typeLabel(e: FileEntry): string {
  if (e.kind === 'dir') return 'Folder'
  const dot = e.name.lastIndexOf('.')
  return dot > 0 ? `${e.name.slice(dot + 1).toUpperCase()} file` : 'File'
}
