import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { isTauri } from '@/lib/platform'

/** Windows caption buttons (macOS uses its native traffic lights instead). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri) return
    const win = getCurrentWindow()
    void win.isMaximized().then(setMaximized)
    const unlisten = win.onResized(() => void win.isMaximized().then(setMaximized))
    return () => {
      void unlisten.then((f) => f())
    }
  }, [])

  const win = () => getCurrentWindow()
  const btn =
    'grid h-full w-11.5 place-items-center text-muted transition-colors hover:bg-surface-3 hover:text-fg'

  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        aria-label="Minimize"
        className={btn}
        onClick={() => isTauri && void win().minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={btn}
        onClick={() => isTauri && void win().toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        className="grid h-full w-11.5 place-items-center text-muted transition-colors hover:bg-[#c42b1c] hover:text-white"
        onClick={() => isTauri && void win().close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  )
}
