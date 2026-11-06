import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/menu'
import { FilesSession } from '@/features/files/FilesSession'
import { HiveHome } from '@/features/hosts/HiveHome'
import { HostEditor } from '@/features/hosts/HostEditor'
import { CommandPalette } from '@/features/palette/CommandPalette'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { Sidebar } from '@/features/shell/Sidebar'
import { TitleBar } from '@/features/shell/TitleBar'
import { TerminalSession } from '@/features/terminal/TerminalSession'
import { cn } from '@/lib/cn'
import { applyEffects } from '@/lib/effects'
import { isTauri } from '@/lib/platform'
import { useHosts } from '@/stores/hosts'
import { resolveDark, usePrefs } from '@/stores/prefs'
import { HOME, useSessions } from '@/stores/sessions'
import { useHotkeys } from './useHotkeys'

export function App() {
  const tabs = useSessions((s) => s.tabs)
  const activeId = useSessions((s) => s.activeId)
  const sidebarOpen = usePrefs((s) => s.sidebarOpen)
  const theme = usePrefs((s) => s.theme)
  const effects = usePrefs((s) => s.effects)
  const dark = resolveDark(theme)

  useHotkeys()

  useEffect(() => {
    void useHosts.getState().load()
    // Show the (initially hidden) window once React has painted — no white flash.
    if (isTauri) requestAnimationFrame(() => void getCurrentWindow().show())
  }, [])

  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle('dark', resolveDark(theme))
    apply()
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => applyEffects(effects), [effects])

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && <Sidebar className="animate-slide-in" />}
          <main className="relative min-w-0 flex-1">
            {/* The Hive cross-fades over the terminal; terminals themselves switch instantly. */}
            <div
              className={cn(
                'absolute inset-0 z-[1] bg-bg transition-[opacity,visibility] duration-150',
                activeId !== HOME && 'invisible opacity-0',
              )}
            >
              <HiveHome />
            </div>
            {/* Every tab stays mounted so shells keep running in the background. */}
            {tabs.map((t) =>
              t.kind === 'files' ? (
                <FilesSession key={t.id} tab={t} active={t.id === activeId} />
              ) : (
                <TerminalSession key={t.id} tab={t} active={t.id === activeId} />
              ),
            )}
          </main>
        </div>
      </div>
      <CommandPalette />
      <HostEditor />
      <SettingsDialog />
      <Toaster
        theme={dark ? 'dark' : 'light'}
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: '!rounded-xl !border-line-strong !bg-surface !text-fg !shadow-card !font-sans',
            description: '!text-muted',
            actionButton: '!bg-honey !text-honey-fg',
          },
        }}
      />
    </TooltipProvider>
  )
}
