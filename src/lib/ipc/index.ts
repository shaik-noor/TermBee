/**
 * The only module that talks to the Rust core. Features import `api` from here — never
 * `invoke` directly — so every command name and payload is typed in one place.
 * Outside Tauri (`npm run dev:web`) a mock backend stands in so the UI can be previewed.
 */
import { Channel, invoke as tauriInvoke } from '@tauri-apps/api/core'
import { isTauri } from '../platform'
import { mockInvoke } from './mock'
import type {
  AppError,
  ConnectRequest,
  DownloadTarget,
  FileEntry,
  Hive,
  Host,
  HostInput,
  KnownHost,
  Place,
  SessionEvent,
  TransferProgress,
} from './types'

export * from './types'

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return isTauri ? await tauriInvoke<T>(cmd, args) : await mockInvoke<T>(cmd, args)
  } catch (e) {
    throw toAppError(e)
  }
}

export function toAppError(e: unknown): AppError {
  if (e && typeof e === 'object' && 'message' in e) {
    const err = e as Partial<AppError>
    return { kind: err.kind ?? 'unknown', message: String(err.message) }
  }
  return { kind: 'unknown', message: typeof e === 'string' ? e : 'Something went wrong.' }
}

/** A Tauri `Channel` in the app; the bare callback for the browser mock. */
function stream<T>(onMessage: (m: T) => void): Channel<T> | ((m: T) => void) {
  if (!isTauri) return onMessage
  const channel = new Channel<T>()
  channel.onmessage = onMessage
  return channel
}

export interface SessionStream {
  onEvent: (event: SessionEvent) => void
}

export const api = {
  hosts: {
    list: () => call<Host[]>('hosts_list'),
    /** Hosts plus every folder path (the sidebar tree). */
    hive: () => call<Hive>('hosts_hive'),
    save: (input: HostInput) => call<Host>('hosts_save', { input }),
    remove: (id: string) => call<void>('hosts_delete', { id }),
    /** Moves hosts into `folder` (null = top level), before `before` or at the end. */
    move: (ids: string[], folder: string | null, before: string | null) =>
      call<Hive>('hosts_move', { ids, folder, before }),
    defaultKeyPaths: () => call<string[]>('ssh_default_key_paths'),
  },
  folders: {
    create: (path: string) => call<Hive>('folders_create', { path }),
    /** Renames or moves a folder with everything inside. */
    move: (from: string, to: string) => call<Hive>('folders_move', { from, to }),
    /** Deletes a folder; its hosts and subfolders move up a level. */
    remove: (path: string) => call<Hive>('folders_delete', { path }),
  },
  rdp: {
    /** Opens a saved RDP host in the OS Remote Desktop client (mstsc / Windows App). */
    open: (hostId: string) => call<void>('rdp_open', { hostId }),
  },
  ssh: {
    /** Starts a session; returns its id. Everything else arrives through `onEvent`. */
    connect: (request: ConnectRequest, onEvent: (e: SessionEvent) => void) =>
      call<string>('ssh_connect', { request, onEvent: stream(onEvent) }),
    write: (sessionId: string, data: string) => call<void>('ssh_write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      call<void>('ssh_resize', { sessionId, cols, rows }),
    close: (sessionId: string) => call<void>('ssh_close', { sessionId }),
    answerHostKey: (sessionId: string, accept: boolean) =>
      call<void>('ssh_host_key_decision', { sessionId, accept }),
  },
  /** File access on a session opened with `mode: 'sftp'`. */
  sftp: {
    home: (sessionId: string) => call<string>('sftp_home', { sessionId }),
    list: (sessionId: string, path: string) => call<FileEntry[]>('sftp_list', { sessionId, path }),
    mkdir: (sessionId: string, path: string) => call<void>('sftp_mkdir', { sessionId, path }),
    rename: (sessionId: string, from: string, to: string) =>
      call<void>('sftp_rename', { sessionId, from, to }),
    /** Deletes a file, or a folder with everything in it. */
    remove: (sessionId: string, path: string, dir: boolean) =>
      call<void>('sftp_delete', { sessionId, path, dir }),
    /** The first `maxBytes` of a file (previews, the text editor). */
    read: (sessionId: string, path: string, maxBytes: number) =>
      call<ArrayBuffer>('sftp_read', { sessionId, path, maxBytes }),
    writeText: (sessionId: string, path: string, text: string) =>
      call<void>('sftp_write_text', { sessionId, path, text }),
    /** Copies a file or folder to `to` on the same server. */
    copy: (
      sessionId: string,
      transferId: string,
      from: string,
      to: string,
      onProgress: (p: TransferProgress) => void,
    ) =>
      call<void>('sftp_copy', { sessionId, transferId, from, to, onProgress: stream(onProgress) }),
    /** A file or a whole folder; resolves to the local path it was saved to. */
    download: (
      sessionId: string,
      transferId: string,
      remotePath: string,
      target: DownloadTarget,
      onProgress: (p: TransferProgress) => void,
    ) =>
      call<string>('sftp_download', {
        sessionId,
        transferId,
        remotePath,
        target,
        onProgress: stream(onProgress),
      }),
    upload: (
      sessionId: string,
      transferId: string,
      localPath: string,
      remotePath: string,
      onProgress: (p: TransferProgress) => void,
    ) =>
      call<void>('sftp_upload', {
        sessionId,
        transferId,
        localPath,
        remotePath,
        onProgress: stream(onProgress),
      }),
    cancel: (transferId: string) => call<void>('sftp_cancel_transfer', { transferId }),
  },
  /** The This PC pane. Deleting always goes to the Recycle Bin / Trash. */
  local: {
    places: () => call<Place[]>('local_places'),
    list: (path: string) => call<FileEntry[]>('local_list', { path }),
    mkdir: (path: string) => call<void>('local_mkdir', { path }),
    rename: (from: string, to: string) => call<void>('local_rename', { from, to }),
    copy: (from: string, to: string) => call<void>('local_copy', { from, to }),
    trash: (paths: string[]) => call<void>('local_trash', { paths }),
    read: (path: string, maxBytes: number) => call<ArrayBuffer>('local_read', { path, maxBytes }),
    open: (path: string) => call<void>('local_open', { path }),
    reveal: (path: string) => call<void>('local_reveal', { path }),
  },
  knownHosts: {
    list: () => call<KnownHost[]>('known_hosts_list'),
    forget: (hostname: string, port: number) =>
      call<void>('known_hosts_forget', { hostname, port }),
  },
}
