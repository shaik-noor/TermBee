import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applyEffects } from './lib/effects'
import { usePrefs } from './stores/prefs'
import './styles/globals.css'

// Before the first paint, so a slow machine never runs the entry animations.
applyEffects(usePrefs.getState().effects)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
