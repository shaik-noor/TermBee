import { ArrowDown, ArrowUp, CopyPlus, Minus, Plus, Power, RotateCw, Search, X } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { label as shortcut } from '@/lib/shortcuts'
import { usePrefs } from '@/stores/prefs'
import { isLive, type Tab, useSessions } from '@/stores/sessions'
import { IconBtn, SessionHeader, SessionOverlay, SwitchKindButton } from './sessionChrome'
import { TERMINAL_BG } from './theme'
import { type SessionIO, useSshSession } from './useSshSession'
import { useXterm } from './useXterm'

/** One tab's terminal. Stays mounted while hidden so the shell keeps running. */
export const TerminalSession = memo(function TerminalSession({
  tab,
  active,
}: {
  tab: Tab
  active: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<ReturnType<typeof useSshSession> | null>(null)
  const xterm = useXterm(container, {
    onData: (d) => sessionRef.current?.send(d),
    onResize: (c, r) => sessionRef.current?.resize(c, r),
  })
  const io = useRef<SessionIO>({
    ready: () => !!xterm.current.term,
    size: () => ({ cols: xterm.current.term?.cols ?? 80, rows: xterm.current.term?.rows ?? 24 }),
    write: (data) => xterm.current.write(data),
    onConnected: () => {
      xterm.current.fit()
      requestAnimationFrame(() => xterm.current.focus())
    },
  })
  const session = useSshSession(tab, io)
  sessionRef.current = session

  const { reconnect, duplicate } = useSessions.getState()
  const fontSize = usePrefs((s) => s.fontSize)
  const setPrefs = usePrefs((s) => s.set)

  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const findInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => {
      xterm.current.fit()
      if (!session.overlay || session.overlay.kind === 'ended') xterm.current.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [active, session.overlay, xterm])

  // The window-level "find" shortcut targets the active tab.
  useEffect(() => {
    if (!active) return
    const onFind = () => {
      setFindOpen(true)
      requestAnimationFrame(() => findInput.current?.select())
    }
    window.addEventListener('termbee:find', onFind)
    return () => window.removeEventListener('termbee:find', onFind)
  }, [active])

  const closeFind = () => {
    setFindOpen(false)
    xterm.current.clearSearch()
    xterm.current.focus()
  }

  const live = isLive(tab.status)

  return (
    <div
      className={cn('absolute inset-0 flex flex-col', !active && 'invisible pointer-events-none')}
      aria-hidden={!active}
    >
      <SessionHeader tab={tab}>
        <SwitchKindButton tab={tab} />

        {findOpen && (
          <div className="mr-1 flex h-8 items-center gap-1 rounded-lg border border-honey/40 bg-surface-2 pr-1 pl-2.5 animate-rise">
            <Search className="size-3.5 text-subtle" />
            <input
              ref={findInput}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                xterm.current.findNext(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  (e.shiftKey ? xterm.current.findPrevious : xterm.current.findNext)(query)
                if (e.key === 'Escape') closeFind()
              }}
              placeholder="Find in output"
              className="w-40 bg-transparent text-xs outline-none placeholder:text-subtle"
            />
            <IconBtn
              label="Previous (Shift+Enter)"
              onClick={() => xterm.current.findPrevious(query)}
            >
              <ArrowUp />
            </IconBtn>
            <IconBtn label="Next (Enter)" onClick={() => xterm.current.findNext(query)}>
              <ArrowDown />
            </IconBtn>
            <IconBtn label="Close (Esc)" onClick={closeFind}>
              <X />
            </IconBtn>
          </div>
        )}
        {!findOpen && (
          <IconBtn
            label={`Find (${shortcut('find')})`}
            onClick={() => window.dispatchEvent(new Event('termbee:find'))}
          >
            <Search />
          </IconBtn>
        )}
        <div className="mx-1 flex items-center rounded-lg border border-line">
          <IconBtn
            label={`Smaller text (${shortcut('zoomOut')})`}
            onClick={() => setPrefs({ fontSize: Math.max(10, fontSize - 1) })}
          >
            <Minus />
          </IconBtn>
          <span className="w-7 text-center font-mono text-[11px] text-muted tabular-nums">
            {fontSize}
          </span>
          <IconBtn
            label={`Larger text (${shortcut('zoomIn')})`}
            onClick={() => setPrefs({ fontSize: Math.min(24, fontSize + 1) })}
          >
            <Plus />
          </IconBtn>
        </div>
        <IconBtn label="Duplicate tab" onClick={() => duplicate(tab.id)}>
          <CopyPlus />
        </IconBtn>
        {live ? (
          <IconBtn label="Disconnect" onClick={session.disconnect} danger>
            <Power />
          </IconBtn>
        ) : (
          <IconBtn label="Reconnect" onClick={() => reconnect(tab.id)}>
            <RotateCw />
          </IconBtn>
        )}
      </SessionHeader>

      {/* Terminal */}
      <div className="relative min-h-0 flex-1" style={{ background: TERMINAL_BG }}>
        <div ref={container} className="absolute inset-0" />
        <SessionOverlay tab={tab} session={session} />
      </div>
    </div>
  )
})
