import * as CM from '@radix-ui/react-context-menu'
import * as DM from '@radix-ui/react-dropdown-menu'
import * as T from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const surface =
  'z-50 min-w-48 overflow-hidden rounded-xl border border-line-strong bg-surface p-1 shadow-card animate-menu-in data-[state=closed]:animate-fade-out'
const item =
  'flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-fg outline-none select-none data-highlighted:bg-honey-soft data-highlighted:text-fg data-disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-muted'

export const DropdownMenu = DM.Root
export const DropdownTrigger = DM.Trigger

export function DropdownContent({
  children,
  align = 'end',
}: {
  children: ReactNode
  align?: 'start' | 'end'
}) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn(surface, 'origin-(--radix-dropdown-menu-content-transform-origin)')}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  )
}

export function DropdownItem({
  children,
  onSelect,
  danger,
  shortcut,
}: {
  children: ReactNode
  onSelect: () => void
  danger?: boolean
  shortcut?: string
}) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(item, danger && 'text-rose [&_svg]:text-rose data-highlighted:bg-rose/12')}
    >
      {children}
      {shortcut && <span className="ml-auto pl-4 text-[11px] text-subtle">{shortcut}</span>}
    </DM.Item>
  )
}

export const DropdownSeparator = () => <DM.Separator className="my-1 h-px bg-line" />

export const ContextMenu = CM.Root
export const ContextTrigger = CM.Trigger

export function ContextContent({ children }: { children: ReactNode }) {
  return (
    <CM.Portal>
      <CM.Content className={cn(surface, 'origin-(--radix-context-menu-content-transform-origin)')}>
        {children}
      </CM.Content>
    </CM.Portal>
  )
}

export function ContextItem({
  children,
  onSelect,
  danger,
}: {
  children: ReactNode
  onSelect: () => void
  danger?: boolean
}) {
  return (
    <CM.Item
      onSelect={onSelect}
      className={cn(item, danger && 'text-rose [&_svg]:text-rose data-highlighted:bg-rose/12')}
    >
      {children}
    </CM.Item>
  )
}

export const ContextSeparator = () => <CM.Separator className="my-1 h-px bg-line" />

export const TooltipProvider = T.Provider

export function Tooltip({
  label,
  children,
  side = 'bottom',
}: {
  label: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 origin-(--radix-tooltip-content-transform-origin) rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow-card animate-menu-in data-[state=closed]:animate-fade-out"
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
