/**
 * "Motion & effects": full motion and blur on capable machines, a flat, instant UI on slow
 * ones. `auto` follows the OS reduce-motion setting and a rough hardware check. The result
 * goes on <html data-effects>, and globals.css does the rest.
 */
export type EffectsPref = 'auto' | 'full' | 'reduced'
export type Effects = 'full' | 'reduced'

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)')

/** Few cores or little memory (`deviceMemory` is Chromium-only, so WebView2 but not macOS). */
export function isLowEndDevice(): boolean {
  const cores = navigator.hardwareConcurrency || 8
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8
  return cores <= 4 || memory <= 4
}

export function resolveEffects(pref: EffectsPref): Effects {
  if (pref !== 'auto') return pref
  return reduceMotion().matches || isLowEndDevice() ? 'reduced' : 'full'
}

/** Applies the pref now and, for `auto`, again whenever the OS motion setting changes. */
export function applyEffects(pref: EffectsPref): () => void {
  const apply = () => {
    document.documentElement.dataset.effects = resolveEffects(pref)
  }
  apply()
  if (pref !== 'auto') return () => {}
  const mq = reduceMotion()
  mq.addEventListener('change', apply)
  return () => mq.removeEventListener('change', apply)
}
