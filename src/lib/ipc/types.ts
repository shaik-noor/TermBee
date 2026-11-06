/**
 * Types shared with the Rust core. Each mirrors a serde type — keep them in sync:
 *   Host / HostInput / Hive / Protocol / AuthMethod / SecretUpdate → src-tauri/src/hosts/mod.rs
 *   ConnectRequest / SessionMode                 → src-tauri/src/ssh/session.rs
 *   SessionEvent                                 → src-tauri/src/ssh/events.rs
 *   KnownHost                                    → src-tauri/src/ssh/known_hosts.rs
 *   FileEntry / TransferProgress                 → src-tauri/src/files.rs
 *   DownloadTarget                               → src-tauri/src/sftp/commands.rs
 *   Place                                        → src-tauri/src/local.rs
 */

/**
 * How a host opens: `ssh` a terminal tab, `sftp` a files tab, `rdp` the OS Remote Desktop
 * client. SSH and SFTP hosts can always open the other kind of tab too.
 */
export type Protocol = 'ssh' | 'sftp' | 'rdp'

export type AuthMethod = { type: 'password' } | { type: 'key'; keyPath: string }

export type SecretKind = 'password' | 'passphrase'

export type HostColor = 'honey' | 'amber' | 'clover' | 'sky' | 'lilac' | 'rose' | 'slate'

export interface Host {
  id: string
  protocol: Protocol
  label: string
  hostname: string
  port: number
  username: string
  auth: AuthMethod
  /** Folder path, `/`-separated (`Production/EU`); null = top level. */
  group: string | null
  /** Position within its folder (drag-and-drop order). */
  order: number
  tags: string[]
  color: HostColor
  /** Icon key from `HOST_ICONS`; null shows initials. */
  icon: string | null
  notes: string | null
  favorite: boolean
  savedSecrets: { password: boolean; passphrase: boolean }
  createdAt: string
  updatedAt: string
  lastConnectedAt: string | null
}

/** Hosts plus every folder path (including empty folders), A→Z. */
export interface Hive {
  hosts: Host[]
  folders: string[]
}

export type SecretUpdate =
  | { action: 'keep' }
  | { action: 'set'; value: string }
  | { action: 'clear' }

export interface HostInput {
  id?: string
  protocol?: Protocol
  label: string
  hostname: string
  port: number
  username: string
  auth: AuthMethod
  group?: string | null
  tags?: string[]
  color?: HostColor
  icon?: string | null
  notes?: string | null
  favorite?: boolean
  password?: SecretUpdate
  passphrase?: SecretUpdate
}

/** What a session opens after login: a PTY shell, or the SFTP subsystem. */
export type SessionMode = 'shell' | 'sftp'

export interface ConnectRequest {
  mode?: SessionMode
  hostId?: string | null
  hostname: string
  port: number
  username: string
  auth: AuthMethod
  password?: string | null
  passphrase?: string | null
  remember?: boolean
  cols: number
  rows: number
}

export type SessionPhase = 'connecting' | 'handshake' | 'authenticating' | 'connected'

export type SessionEvent =
  | { type: 'phase'; phase: SessionPhase }
  | {
      type: 'hostKey'
      kind: 'unknown' | 'changed'
      hostname: string
      port: number
      algorithm: string
      fingerprint: string
      previousFingerprint: string | null
    }
  | { type: 'data'; data: string }
  | { type: 'secretRequired'; secret: SecretKind; message: string }
  | { type: 'authFailed'; secret: SecretKind | null; message: string }
  | { type: 'error'; message: string }
  | { type: 'closed'; exitStatus: number | null }

export interface KnownHost {
  hostname: string
  port: number
  algorithm: string
  fingerprint: string
  key: string
  addedAt: string
}

/** A row of a directory listing, on this computer or on the server. */
export interface FileEntry {
  name: string
  /** Full path in the pane's own convention (`/` remote, `\` on Windows locally). */
  path: string
  /** For a symlink, the kind of what it points to. */
  kind: 'file' | 'dir' | 'other'
  link: boolean
  /** Dotfiles, and Windows files with the hidden attribute. */
  hidden: boolean
  size: number
  /** Unix seconds. */
  modified: number | null
  /** `drwxr-xr-x` style. */
  permissions: string | null
}

export interface TransferProgress {
  done: number
  total: number
  filesDone: number
  filesTotal: number
  /** The file being moved right now (folder transfers). */
  current: string | null
}

/** A shortcut in the This PC pane. */
export interface Place {
  label: string
  path: string
  kind: 'home' | 'desktop' | 'documents' | 'downloads' | 'drive'
}

/** Where a download goes: a path the user picked, or a folder (keeps the remote name). */
export type DownloadTarget = { type: 'file'; path: string } | { type: 'dir'; dir: string }

/** Shape of every error a command can reject with (see src-tauri/src/error.rs). */
export interface AppError {
  kind:
    | 'notFound'
    | 'invalid'
    | 'clientMissing'
    | 'remote'
    | 'cancelled'
    | 'keychain'
    | 'io'
    | 'json'
    | 'unknown'
  message: string
}
