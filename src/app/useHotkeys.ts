import { useEffect } from 'react'
import { matchAny } from '@/lib/shortcuts'
import { usePrefs } from '@/stores/prefs'
import { HOME, useSessions } from '@/stores/sessions'
import { useUi } from '@/stores/ui'

/** Window-level shortcuts. The terminal lets these bubble up (see useXterm). */
export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchAny(e)
      if (!id || id === 'copy' || id === 'paste') return
      const ui = useUi.getState()
      const sessions = useSessions.getState()
      const prefs = usePrefs.getState()
      e.preventDefault()
      switch (id) {
        case 'palette':
        case 'newTab':
          ui.setPalette(!ui.paletteOpen)
          break
        case 'closeTab':
          if (sessions.activeId !== HOME) sessions.close(sessions.activeId)
          break
        case 'nextTab':
          sessions.cycle(1)
          break
        case 'prevTab':
          sessions.cycle(-1)
          break
        case 'find':
          window.dispatchEvent(new Event('termbee:find'))
          break
        case 'newHost':
          ui.editHost('new')
          break
        case 'settings':
          ui.setSettings(true)
          break
        case 'sidebar':
          prefs.set({ sidebarOpen: !prefs.sidebarOpen })
          break
        case 'zoomIn':
          prefs.set({ fontSize: Math.min(24, prefs.fontSize + 1) })
          break
        case 'zoomOut':
          prefs.set({ fontSize: Math.max(10, prefs.fontSize - 1) })
          break
        case 'zoomReset':
          prefs.set({ fontSize: 14 })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
