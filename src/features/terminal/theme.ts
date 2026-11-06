import type { ITheme } from '@xterm/xterm'

/** "Honeycomb" — the terminal is always dark (it reads best that way), in both app themes. */
export const TERMINAL_BG = '#100c07'

export const honeyTheme: ITheme = {
  background: TERMINAL_BG,
  foreground: '#f1e7d0',
  cursor: '#ffc93c',
  cursorAccent: '#1c1408',
  selectionBackground: 'rgba(249, 178, 26, 0.30)',
  selectionInactiveBackground: 'rgba(249, 178, 26, 0.16)',
  black: '#2a2218',
  red: '#f2706a',
  green: '#93d47a',
  yellow: '#f9c23c',
  blue: '#74b3f2',
  magenta: '#cf97ef',
  cyan: '#6dd1c3',
  white: '#e6dcc6',
  brightBlack: '#6f6350',
  brightRed: '#ff9289',
  brightGreen: '#b3eb98',
  brightYellow: '#ffd866',
  brightBlue: '#9ccbff',
  brightMagenta: '#e2b6ff',
  brightCyan: '#94e8dc',
  brightWhite: '#fff8e8',
}

export const TERMINAL_FONT = '"JetBrains Mono Variable", "Cascadia Mono", Menlo, monospace'
