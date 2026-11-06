import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type SecretKind, type SessionEvent, type SessionPhase } from '@/lib/ipc'
import { refreshHosts } from '@/stores/hosts'
import { type Tab, useSessions } from '@/stores/sessions'

export type HostKeyEvent = Extract<SessionEvent, { type: 'hostKey' }>

/** What the terminal area shows on top of (or instead of) the shell. */
export type Overlay =
  | { kind: 'connecting'; phase: SessionPhase }
  | { kind: 'hostKey'; event: HostKeyEvent }
  | { kind: 'secret'; secret: SecretKind; message: string; failed: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'ended'; exitStatus: number | null }
  | null

/** What the session needs from the view showing it (a terminal, or nothing for files). */
export interface SessionIO {
  /** False until the view can report a real size (xterm mounted). */
  ready: () => boolean
  size: () => { cols: number; rows: number }
  /** Server output and login banners. */
  write: (data: string) => void
  onConnected: () => void
}

export interface SecretAnswer {
  secret: SecretKind
  value: string
  remember: boolean
}

/**
 * Connection lifecycle for one tab: a shell for terminal tabs, the SFTP subsystem for files
 * tabs (same host-key, login and secret prompts). Each attempt gets a generation number so
 * late events from an abandoned attempt (e.g. after Reconnect) are ignored.
 */
export function useSshSession(tab: Tab, io: React.RefObject<SessionIO>) {
  const setStatus = useSessions((s) => s.setStatus)
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'connecting', phase: 'connecting' })
  const sessionId = useRef<string | null>(null)
  /** The id of the session once it is connected (files tabs call `api.sftp.*` with it). */
  const [liveId, setLiveId] = useState<string | null>(null)
  const connected = useRef(false)
  const generation = useRef(0)
  const hadOutput = useRef(false)
  /** A terminal outcome (error / prompt) was shown; `closed` must not replace it. */
  const settled = useRef(false)

  const connect = useCallback(
    (answer?: SecretAnswer) => {
      if (!io.current.ready()) return
      const size = io.current.size()
      const gen = ++generation.current
      if (sessionId.current) void api.ssh.close(sessionId.current).catch(() => {})
      sessionId.current = null
      connected.current = false
      settled.current = false
      setLiveId(null)
      if (hadOutput.current) io.current.write('\r\n\x1b[38;5;178m── reconnecting ──\x1b[0m\r\n')
      setOverlay({ kind: 'connecting', phase: 'connecting' })
      setStatus(tab.id, 'connecting')

      let resolveId: (id: string) => void = () => {}
      const idReady = new Promise<string>((r) => {
        resolveId = r
      })

      const onEvent = (ev: SessionEvent) => {
        if (gen !== generation.current) return
        switch (ev.type) {
          case 'phase':
            setStatus(tab.id, ev.phase)
            if (ev.phase === 'connected') {
              connected.current = true
              setOverlay(null)
              io.current.onConnected()
              void idReady.then((id) => gen === generation.current && setLiveId(id))
              void refreshHosts()
            } else {
              setOverlay({ kind: 'connecting', phase: ev.phase })
            }
            break
          case 'hostKey':
            setOverlay({ kind: 'hostKey', event: ev })
            hostKeyAnswer.current = async (accept: boolean) => {
              const id = await idReady
              if (gen !== generation.current) return
              setOverlay(accept ? { kind: 'connecting', phase: 'handshake' } : null)
              await api.ssh.answerHostKey(id, accept).catch(() => {})
            }
            break
          case 'data':
            hadOutput.current = true
            io.current.write(ev.data)
            break
          case 'secretRequired':
            settled.current = true
            setOverlay({ kind: 'secret', secret: ev.secret, message: ev.message, failed: false })
            setStatus(tab.id, 'idle')
            break
          case 'authFailed':
            settled.current = true
            setOverlay(
              ev.secret
                ? { kind: 'secret', secret: ev.secret, message: ev.message, failed: true }
                : { kind: 'error', message: ev.message },
            )
            setStatus(tab.id, ev.secret ? 'idle' : 'error')
            break
          case 'error':
            settled.current = true
            setOverlay({ kind: 'error', message: ev.message })
            setStatus(tab.id, 'error')
            break
          case 'closed': {
            const wasConnected = connected.current
            connected.current = false
            sessionId.current = null
            setLiveId(null)
            if (!settled.current) {
              setOverlay(
                wasConnected
                  ? { kind: 'ended', exitStatus: ev.exitStatus }
                  : { kind: 'error', message: 'The connection was closed.' },
              )
              setStatus(tab.id, wasConnected ? 'closed' : 'error')
            }
            break
          }
        }
      }

      const t = tab.target
      api.ssh
        .connect(
          {
            mode: tab.kind === 'files' ? 'sftp' : 'shell',
            hostId: t.hostId,
            hostname: t.hostname,
            port: t.port,
            username: t.username,
            auth: t.auth,
            password: answer?.secret === 'password' ? answer.value : null,
            passphrase: answer?.secret === 'passphrase' ? answer.value : null,
            remember: answer?.remember ?? false,
            cols: size.cols,
            rows: size.rows,
          },
          onEvent,
        )
        .then((id) => {
          if (gen !== generation.current) {
            void api.ssh.close(id).catch(() => {})
            return
          }
          sessionId.current = id
          resolveId(id)
        })
        .catch((e: Error) => {
          if (gen !== generation.current) return
          settled.current = true
          setOverlay({ kind: 'error', message: e.message })
          setStatus(tab.id, 'error')
        })
    },
    [tab.id, tab.kind, tab.target, setStatus, io],
  )

  const hostKeyAnswer = useRef<(accept: boolean) => Promise<void>>(async () => {})

  // Connect on mount and whenever the tab asks to reconnect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the trigger.
  useEffect(() => {
    // Wait a frame so the terminal has fitted and reports the real cols×rows.
    const id = requestAnimationFrame(() => connect())
    return () => cancelAnimationFrame(id)
  }, [tab.attempt])

  // Close the remote session when the tab goes away.
  useEffect(
    () => () => {
      generation.current++
      if (sessionId.current) void api.ssh.close(sessionId.current).catch(() => {})
    },
    [],
  )

  const send = useCallback(
    (data: string) => {
      if (connected.current && sessionId.current) {
        void api.ssh.write(sessionId.current, data).catch(() => {})
      } else if (overlay?.kind === 'ended' && data === '\r') {
        connect()
      }
    },
    [overlay, connect],
  )

  const resize = useCallback((cols: number, rows: number) => {
    if (connected.current && sessionId.current)
      void api.ssh.resize(sessionId.current, cols, rows).catch(() => {})
  }, [])

  const disconnect = useCallback(() => {
    if (sessionId.current) void api.ssh.close(sessionId.current).catch(() => {})
  }, [])

  return {
    liveId,
    overlay,
    connect,
    send,
    resize,
    disconnect,
    answerHostKey: (accept: boolean) => hostKeyAnswer.current(accept),
    dismissOverlay: () => setOverlay(null),
  }
}
