import { type ComponentProps, forwardRef } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'honey' | 'ghost' | 'outline' | 'subtle' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<Variant, string> = {
  honey:
    'bg-honey text-honey-fg hover:bg-honey-strong shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] active:translate-y-px',
  ghost: 'text-muted hover:text-fg hover:bg-surface-3/70',
  outline: 'border border-line-strong text-fg hover:bg-surface-2 hover:border-honey/40',
  subtle: 'bg-surface-2 text-fg hover:bg-surface-3 border border-line',
  danger: 'bg-rose/90 text-white hover:bg-rose active:translate-y-px',
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'size-9 rounded-lg',
  'icon-sm': 'size-7 rounded-md',
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'subtle', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'no-drag inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,border-color,translate,scale] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
