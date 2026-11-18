import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { PACKAGE_NAME, PUBLISHER, PUBLISHER_DISPLAY_NAME, PACKAGE_VERSION } = process.env

if (!/^[a-z0-9.-]{3,50}$/i.test(PACKAGE_NAME ?? '')) {
  throw new Error('Set PACKAGE_NAME to Package/Identity/Name from Partner Center.')
}
if (!PUBLISHER?.trim() || !PUBLISHER_DISPLAY_NAME?.trim()) {
  throw new Error(
    'Set PUBLISHER and PUBLISHER_DISPLAY_NAME to the exact Product identity values from Partner Center.',
  )
}
if (
  !/^[1-9]\d{0,4}\.(?:0|[1-9]\d{0,4})\.(?:0|[1-9]\d{0,4})\.0$/.test(PACKAGE_VERSION ?? '') ||
  PACKAGE_VERSION.split('.').some((part) => Number(part) > 65535)
) {
  throw new Error('Set PACKAGE_VERSION to a four-part Store version such as 1.0.0.0.')
}

const root = fileURLToPath(new URL('..', import.meta.url))
const releaseDir = join(root, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release')
const executable = join(releaseDir, 'termbee.exe')
if (!existsSync(executable)) {
  throw new Error(
    'Build termbee.exe first with npm run tauri -- build --target x86_64-pc-windows-msvc --no-bundle.',
  )
}

const sdkBin = join(
  process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  'Windows Kits',
  '10',
  'bin',
)
const makeAppx = (existsSync(sdkBin) ? readdirSync(sdkBin) : [])
  .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name))
  .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  .map((version) => join(sdkBin, version, 'x64', 'makeappx.exe'))
  .find((file) => existsSync(file))
if (!makeAppx) {
  throw new Error('MakeAppx.exe was not found. Install the Windows SDK with MSIX packaging tools.')
}

const outputDir = join(releaseDir, 'bundle', 'msix')
mkdirSync(outputDir, { recursive: true })
const workDir = mkdtempSync(join(outputDir, 'pack-'))
try {
  const contentDir = join(workDir, 'content')
  const assetsDir = join(contentDir, 'Assets')
  mkdirSync(assetsDir, { recursive: true })
  copyFileSync(executable, join(contentDir, 'termbee.exe'))
  for (const logo of ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png']) {
    copyFileSync(join(root, 'src-tauri', 'icons', logo), join(assetsDir, logo))
  }

  const values = { PACKAGE_NAME, PUBLISHER, PUBLISHER_DISPLAY_NAME, PACKAGE_VERSION }
  const xmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  const template = readFileSync(join(root, 'src-tauri', 'msix', 'AppxManifest.xml'), 'utf8')
  const manifest = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) =>
    values[key].replace(/[&<>"]/g, (character) => xmlEntities[character]),
  )
  writeFileSync(join(contentDir, 'AppxManifest.xml'), manifest)

  const filename = `TermBee_${PACKAGE_VERSION}_x64.msix`
  const temporaryPackage = join(workDir, filename)
  execFileSync(makeAppx, ['pack', '/h', 'SHA256', '/d', contentDir, '/p', temporaryPackage], {
    stdio: 'inherit',
  })
  const output = join(outputDir, filename)
  renameSync(temporaryPackage, output)
  console.log(`Store package: ${output}`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
