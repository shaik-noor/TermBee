import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const Dialog = D.Root
export const DialogClose = D.Close

interface ContentProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  hideClose?: boolean
  onOpenAutoFocus?: (e: Event) => void
}

export function DialogContent({
  title,
  description,
  icon,
  children,
  footer,
  className,
  hideClose,
  onOpenAutoFocus,
}: ContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] animate-fade-in data-[state=closed]:animate-fade-out" />
      <D.Content
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[min(720px,calc(100vh-48px))] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-card outline-none animate-pop-in data-[state=closed]:animate-pop-out',
          className,
        )}
      >
        <header className="flex items-start gap-3 px-5 pt-4 pb-3.5">
          {icon && (
            <div className="hex-clip grid size-9 shrink-0 place-items-center bg-honey-soft text-honey [&_svg]:size-[18px]">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <D.Title className="font-display text-[17px] font-semibold tracking-tight">
              {title}
            </D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{String(title)}</D.Description>
            )}
          </div>
          {!hideClose && (
            <D.Close
              className="-mr-2 grid size-8 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </D.Close>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">
            {footer}
          </footer>
        )}
      </D.Content>
    </D.Portal>
  )
}
