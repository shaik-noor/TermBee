import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { isTauri } from './platform'

export async function copyText(text: string): Promise<void> {
  if (isTauri) await writeText(text)
  else await navigator.clipboard.writeText(text)
}

export async function pasteText(): Promise<string> {
  if (isTauri) return (await readText()) ?? ''
  return navigator.clipboard.readText()
}
