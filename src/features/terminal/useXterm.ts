import { openUrl } from '@tauri-apps/plugin-opener'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { type RefObject, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { copyText, pasteText } from '@/lib/clipboard'
import { isTauri } from '@/lib/platform'
import { matchAny, matches } from '@/lib/shortcuts'
import { usePrefs } from '@/stores/prefs'
import { honeyTheme, TERMINAL_FONT } from './theme'

export interface XtermHandle {
  term: Terminal | null
  /** Queue output; flushed once per animation frame (one `write` per frame, not per chunk). */
  write: (data: string) => void
  fit: () => void
  focus: () => void
  findNext: (q: string) => boolean
  findPrevious: (q: string) => boolean
  clearSearch: () => void
}

interface Options {
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
}

/**
 * Owns one xterm instance for the lifetime of the component. Speed rules (learned the
 * hard way — don't regress): create once; batch writes per frame; fit only on a real
 * cols×rows change and never while hidden; add the WebGL renderer only after the web
 * font has loaded (its glyph atlas bakes in the cell size).
 */
export function useXterm(
  container: RefObject<HTMLDivElement | null>,
  opts: Options,
): RefObject<XtermHandle> {
  const optsRef = useRef(opts)
  optsRef.current = opts

  const handle = useRef<XtermHandle>({
    term: null,
    write: () => {},
    fit: () => {},
    focus: () => {},
    findNext: () => false,
    findPrevious: () => false,
    clearSearch: () => {},
  })

  useEffect(() => {
    const el = container.current
    if (!el) return
    const prefs = usePrefs.getState()
    const term = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize: prefs.fontSize,
      lineHeight: 1.18,
      letterSpacing: 0,
      cursorStyle: prefs.cursorStyle,
      cursorBlink: prefs.cursorBlink,
      cursorInactiveStyle: 'outline',
      scrollback: prefs.scrollback,
      theme: honeyTheme,
      allowProposedApi: true,
      macOptionIsMeta: true,
      smoothScrollDuration: 0,
      fontWeightBold: '700',
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(
      new WebLinksAddon((_e, uri) => {
        if (isTauri) void openUrl(uri)
        else window.open(uri, '_blank', 'noopener')
      }),
    )
    term.open(el)

    // --- batched writes
    let queue = ''
    let raf = 0
    const flush = () => {
      raf = 0
      if (queue) {
        term.write(queue)
        queue = ''
      }
    }
    const write = (data: string) => {
      queue += data
      if (!raf) raf = requestAnimationFrame(flush)
    }

    // --- fit (rAF-coalesced, deduped, skipped while hidden)
    let fitRaf = 0
    let last = ''
    const fitNow = () => {
      fitRaf = 0
      if (el.clientWidth < 20 || el.clientHeight < 20) return
      const dims = fit.proposeDimensions()
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
      const key = `${dims.cols}x${dims.rows}`
      if (key === last) return
      last = key
      term.resize(Math.max(dims.cols, 2), Math.max(dims.rows, 2))
    }
    const scheduleFit = () => {
      if (!fitRaf) fitRaf = requestAnimationFrame(fitNow)
    }
    fitNow()
    const ro = new ResizeObserver(scheduleFit)
    ro.observe(el)

    // --- GPU renderer once the font is ready (capped so a slow font never blocks it)
    let disposed = false
    Promise.race([
      document.fonts.load(`${prefs.fontSize}px "JetBrains Mono Variable"`),
      new Promise((r) => setTimeout(r, 400)),
    ]).finally(() => {
      if (disposed) return
      try {
        const gl = new WebglAddon()
        gl.onContextLoss(() => gl.dispose())
        term.loadAddon(gl)
      } catch {
        // DOM renderer fallback is fine.
      }
      last = ''
      fitNow()
      term.refresh(0, term.rows - 1)
    })

    // --- clipboard: copy-on-select + platform copy/paste keys + right-click paste
    let lastCopied = ''
    const copySelection = async (silent: boolean) => {
      const text = term.getSelection()
      if (!text) return false
      if (silent && text === lastCopied) return true
      lastCopied = text
      try {
        await copyText(text)
        if (!silent) toast.success('Copied', { duration: 1200 })
      } catch {
        toast.error('Couldn’t copy to the clipboard')
      }
      return true
    }
    const paste = async () => {
      try {
        const text = await pasteText()
        if (text) term.paste(text)
      } catch {
        toast.error('Couldn’t read the clipboard')
      }
    }
    term.onSelectionChange(() => {
      if (usePrefs.getState().copyOnSelect && term.hasSelection()) void copySelection(true)
    })
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (
        matches(e, 'copy') ||
        (!e.shiftKey &&
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === 'c' &&
          term.hasSelection())
      ) {
        // Clear afterwards so the next Ctrl+C interrupts the program, like Windows Terminal.
        void copySelection(false).then(() => term.clearSelection())
        e.preventDefault()
        return false
      }
      if (matches(e, 'paste')) {
        void paste()
        e.preventDefault()
        return false
      }
      // Let app shortcuts bubble to the window handler instead of reaching the shell.
      return matchAny(e) === null
    })
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      if (term.hasSelection()) void copySelection(false).then(() => term.clearSelection())
      else void paste()
    }
    el.addEventListener('contextmenu', onContextMenu)

    const dataSub = term.onData((d) => optsRef.current.onData(d))
    const resizeSub = term.onResize(({ cols, rows }) => optsRef.current.onResize(cols, rows))

    const searchDecorations = {
      matchBackground: '#5a4410',
      activeMatchBackground: '#f9b21a',
      matchOverviewRuler: '#f9b21a',
      activeMatchColorOverviewRuler: '#ffd866',
    }
    handle.current = {
      term,
      write,
      fit: () => {
        last = ''
        scheduleFit()
      },
      focus: () => term.focus(),
      findNext: (q) => search.findNext(q, { decorations: searchDecorations }),
      findPrevious: (q) => search.findPrevious(q, { decorations: searchDecorations }),
      clearSearch: () => search.clearDecorations(),
    }

    // Live preference changes, applied without rebuilding the terminal.
    const unsub = usePrefs.subscribe((p, prev) => {
      if (p.fontSize !== prev.fontSize) {
        term.options.fontSize = p.fontSize
        last = ''
        scheduleFit()
      }
      if (p.cursorStyle !== prev.cursorStyle) term.options.cursorStyle = p.cursorStyle
      if (p.cursorBlink !== prev.cursorBlink) term.options.cursorBlink = p.cursorBlink
      if (p.scrollback !== prev.scrollback) term.options.scrollback = p.scrollback
    })

    return () => {
      disposed = true
      unsub()
      dataSub.dispose()
      resizeSub.dispose()
      ro.disconnect()
      el.removeEventListener('contextmenu', onContextMenu)
      cancelAnimationFrame(raf)
      cancelAnimationFrame(fitRaf)
      term.dispose()
      handle.current.term = null
    }
  }, [container])

  return handle
}
