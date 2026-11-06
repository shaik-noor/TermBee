import { useCallback, useRef, useState } from 'react'
import { type AppError, api, type TransferProgress } from '@/lib/ipc'
import { baseName } from './source'

/** What a transfer does, kept so Retry can run it again. */
export type TransferJob =
  | { kind: 'upload'; sessionId: string; from: string; to: string }
  | { kind: 'download'; sessionId: string; from: string; toDir: string }
  | { kind: 'copy'; sessionId: string; from: string; to: string }

export interface Transfer {
  id: string
  job: TransferJob
  name: string
  progress: TransferProgress
  /** Bytes per second, smoothed. */
  speed: number
  state: 'running' | 'done' | 'failed' | 'cancelled'
  error?: string
  /** Where a finished download landed. */
  localPath?: string
}

const empty: TransferProgress = { done: 0, total: 0, filesDone: 0, filesTotal: 0, current: null }

/** The transfer queue of one files tab. `onFinished` refreshes the pane that changed. */
export function useTransfers(onFinished: (job: TransferJob) => void) {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const finished = useRef(onFinished)
  finished.current = onFinished

  const patch = useCallback(
    (id: string, p: Partial<Transfer> | ((t: Transfer) => Partial<Transfer>)) =>
      setTransfers((list) =>
        list.map((t) => (t.id === id ? { ...t, ...(typeof p === 'function' ? p(t) : p) } : t)),
      ),
    [],
  )

  const start = useCallback(
    async (job: TransferJob, reuseId?: string) => {
      const id = crypto.randomUUID()
      const row: Transfer = {
        id,
        job,
        name: baseName(job.from),
        progress: empty,
        speed: 0,
        state: 'running',
      }
      setTransfers((list) =>
        reuseId ? list.map((t) => (t.id === reuseId ? row : t)) : [...list, row],
      )
      // Speed from the last ~2 s of samples, so it reacts but doesn't jitter.
      const samples: [number, number][] = [[performance.now(), 0]]
      const onProgress = (p: TransferProgress) => {
        const now = performance.now()
        samples.push([now, p.done])
        while (samples.length > 2 && now - samples[0][0] > 2000) samples.shift()
        const [t0, d0] = samples[0]
        const speed = now > t0 ? ((p.done - d0) * 1000) / (now - t0) : 0
        patch(id, { progress: p, speed })
      }
      try {
        let localPath: string | undefined
        if (job.kind === 'upload')
          await api.sftp.upload(job.sessionId, id, job.from, job.to, onProgress)
        else if (job.kind === 'copy')
          await api.sftp.copy(job.sessionId, id, job.from, job.to, onProgress)
        else
          localPath = await api.sftp.download(
            job.sessionId,
            id,
            job.from,
            { type: 'dir', dir: job.toDir },
            onProgress,
          )
        patch(id, (t) => ({
          state: 'done',
          localPath,
          speed: 0,
          progress: { ...t.progress, done: Math.max(t.progress.done, t.progress.total) },
        }))
        finished.current(job)
      } catch (e) {
        const err = e as AppError
        patch(id, {
          state: err.kind === 'cancelled' ? 'cancelled' : 'failed',
          error: err.message,
          speed: 0,
        })
        finished.current(job)
      }
    },
    [patch],
  )

  const cancel = useCallback((id: string) => void api.sftp.cancel(id).catch(() => {}), [])
  const retry = useCallback((t: Transfer) => void start(t.job, t.id), [start])
  const dismiss = useCallback(
    (id: string) => setTransfers((list) => list.filter((t) => t.id !== id)),
    [],
  )
  const clearFinished = useCallback(
    () => setTransfers((list) => list.filter((t) => t.state === 'running')),
    [],
  )

  return { transfers, start, cancel, retry, dismiss, clearFinished }
}
