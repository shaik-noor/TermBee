import { useId } from 'react'
import { cn } from '@/lib/cn'

/** The TermBee mark: a honeycomb-cell bee whose stripes are a `>_` prompt. */
export function BeeMark({ className, buzzing }: { className?: string; buzzing?: boolean }) {
  const id = useId()
  return (
    <svg
      viewBox="96 70 320 400"
      className={cn('shrink-0', buzzing && 'animate-buzz', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}h`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#FFD866" />
          <stop offset="0.55" stopColor="#F9B21A" />
          <stop offset="1" stopColor="#E58A00" />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFBEF" />
          <stop offset="1" stopColor="#F3E3B8" />
        </linearGradient>
      </defs>
      <ellipse
        cx="164"
        cy="206"
        rx="74"
        ry="44"
        transform="rotate(-28 164 206)"
        fill={`url(#${id}w)`}
        opacity="0.92"
      />
      <ellipse
        cx="348"
        cy="206"
        rx="74"
        ry="44"
        transform="rotate(28 348 206)"
        fill={`url(#${id}w)`}
        opacity="0.92"
      />
      <path
        d="M238 156 C 232 124, 218 106, 202 96"
        fill="none"
        stroke="#FFC93C"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <path
        d="M274 156 C 280 124, 294 106, 310 96"
        fill="none"
        stroke="#FFC93C"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <circle cx="200" cy="94" r="13" fill="#FFC93C" />
      <circle cx="312" cy="94" r="13" fill="#FFC93C" />
      <polygon
        points="256,150 386,225 386,375 256,450 126,375 126,225"
        fill={`url(#${id}h)`}
        stroke={`url(#${id}h)`}
        strokeWidth="26"
        strokeLinejoin="round"
      />
      <polyline
        points="188,262 246,300 188,338"
        fill="none"
        stroke="#1C1408"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="268"
        y1="346"
        x2="330"
        y2="346"
        stroke="#1C1408"
        strokeWidth="30"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Wordmark: "Term" in the UI color, "Bee" in honey. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display font-semibold tracking-tight', className)}>
      Term<span className="text-honey">Bee</span>
    </span>
  )
}
