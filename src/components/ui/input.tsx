import { type ComponentProps, forwardRef, type ReactNode, useId } from 'react'
import { cn } from '@/lib/cn'

export const inputClass =
  'h-9 w-full rounded-lg border border-line-strong bg-surface-2/60 px-3 text-sm text-fg placeholder:text-subtle transition-[border-color,box-shadow] outline-none focus:border-honey/70 focus:ring-3 focus:ring-honey/15 aria-invalid:border-rose/70 aria-invalid:ring-rose/15'

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} spellCheck={false} className={cn(inputClass, className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(inputClass, 'h-auto min-h-18 py-2 resize-none', className)}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  className?: string
  children: (props: {
    id: string
    'aria-invalid'?: boolean
    'aria-describedby'?: string
  }) => ReactNode
}

/** Label + control + hint/error, wired up for screen readers. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  const descId = `${id}-desc`
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': hint || error ? descId : undefined,
      })}
      {error ? (
        <p id={descId} role="alert" className="text-xs text-rose">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-sans text-[10.5px] font-medium text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
