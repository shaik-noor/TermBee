#!/usr/bin/env node
// Builds TermBee on this machine and uploads the installer to a GitHub release.
//
//   npm run release              checks, build, upload to release v<version>
//   npm run release -- --dry-run checks + build only, nothing is uploaded
//   npm run release -- --draft   create the release as a draft (publish it on GitHub later)
//   npm run release -- --skip-checks
//
// Run it once on Windows (→ .exe) and once on a Mac (→ universal .dmg). Both runs upload to
// the same release, so the second one just adds its file. The version comes from
// package.json and must match src-tauri/Cargo.toml.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const draft = args.has('--draft')
const skipChecks = args.has('--skip-checks')
const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function step(message) {
  console.log(`\n▸ ${message}`)
}

/** Runs a command with live output and stops the release if it fails. */
function run(cmd, cmdArgs) {
  // npm/npx are .cmd shims on Windows and need a shell; everything else is a real binary.
  const shell = isWin && (cmd === 'npm' || cmd === 'npx')
  const res = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell })
  if (res.error) fail(`Couldn't run ${cmd}: ${res.error.message}`)
  if (res.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed (exit ${res.status}).`)
}

/** Runs a command quietly and returns its trimmed stdout, or null if it failed. */
function read(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8' })
  return res.status === 0 ? res.stdout.trim() : null
}

if (!isWin && !isMac) fail('Releases are built on Windows (.exe) or macOS (.dmg).')

// --- Version -------------------------------------------------------------------------------

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const cargoVersion = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8').match(
  /^version\s*=\s*"([^"]+)"/m,
)?.[1]
if (version !== cargoVersion) {
  fail(
    `package.json is ${version} but src-tauri/Cargo.toml is ${cargoVersion}. Set both to the same version.`,
  )
}
const tag = `v${version}`
console.log(`TermBee ${tag} — ${isWin ? 'Windows installer' : 'macOS universal .dmg'}`)

// --- Preflight -----------------------------------------------------------------------------

step('Checking git and GitHub')
const head = read('git', ['rev-parse', 'HEAD'])
if (!head) fail('This is not a git checkout.')
if (read('git', ['status', '--porcelain'])) {
  if (dryRun) console.warn('  ! Uncommitted changes (fine for a dry run).')
  else fail('Commit or stash your changes first, so the release matches what is on GitHub.')
}

if (!dryRun) {
  if (!read('gh', ['--version'])) fail('Install the GitHub CLI first: https://cli.github.com')
  if (read('gh', ['auth', 'status']) === null) fail('Log in to GitHub first: gh auth login')

  run('git', ['fetch', '--quiet', '--tags', 'origin'])
  const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'main') fail(`Releases come from main (you are on ${branch}).`)
  if (read('git', ['rev-parse', 'origin/main']) !== head) {
    fail('Your main differs from origin/main. Pull or push first.')
  }

  // A second run (the other OS) must build the same commit the release was made from.
  const tagged = read('git', ['rev-list', '-n', '1', tag])
  if (tagged && tagged !== head) {
    fail(
      `${tag} already points at ${tagged.slice(0, 7)}, not your ${head.slice(0, 7)}. ` +
        'Check out that commit, or bump the version for a new release.',
    )
  }
}

// --- Checks --------------------------------------------------------------------------------

if (skipChecks) {
  step('Skipping checks (--skip-checks)')
} else {
  step('Running checks (typecheck, lint, clippy, tests)')
  run('npm', ['run', 'typecheck'])
  run('npm', ['run', 'lint'])
  run('cargo', [
    'clippy',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--all-targets',
    '--',
    '-D',
    'warnings',
  ])
  run('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml'])
}

// --- Build ---------------------------------------------------------------------------------

let bundleDir
let pattern
if (isWin) {
  bundleDir = join(root, 'src-tauri/target/release/bundle/nsis')
  pattern = new RegExp(`^TermBee_${version.replaceAll('.', '\\.')}_.*-setup\\.exe$`)
} else {
  step('Adding the Apple Silicon and Intel Rust targets')
  run('rustup', ['target', 'add', 'aarch64-apple-darwin', 'x86_64-apple-darwin'])
  bundleDir = join(root, 'src-tauri/target/universal-apple-darwin/release/bundle/dmg')
  pattern = new RegExp(`^TermBee_${version.replaceAll('.', '\\.')}_universal\\.dmg$`)
}

// Clear old installers so we never upload a stale one.
if (existsSync(bundleDir)) rmSync(bundleDir, { recursive: true, force: true })

step('Building the installer (this takes a few minutes)')
run('npm', [
  'run',
  'tauri',
  '--',
  'build',
  ...(isMac ? ['--target', 'universal-apple-darwin'] : []),
])

const files = existsSync(bundleDir) ? readdirSync(bundleDir).filter((f) => pattern.test(f)) : []
if (files.length === 0) fail(`The build finished but no installer was found in ${bundleDir}.`)
const assets = files.map((f) => join(bundleDir, f))
for (const a of assets) console.log(`  ✓ ${a}`)

if (dryRun) {
  console.log('\n✔ Dry run done. Nothing was uploaded.')
  process.exit(0)
}

// --- Release -------------------------------------------------------------------------------

const repoUrl = read('gh', ['repo', 'view', '--json', 'url', '--jq', '.url'])

if (read('gh', ['release', 'view', tag, '--json', 'tagName']) === null) {
  step(`Creating release ${tag}`)
  const previous = read('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'])
  const log = read('git', [
    'log',
    '--no-merges',
    '--format=- %s',
    previous ? `${previous}..HEAD` : 'HEAD',
  ])
  const notes = [
    '## Download',
    '',
    `- **Windows 10/11:** \`TermBee_${version}_x64-setup.exe\``,
    `- **macOS 11+ (Apple Silicon and Intel):** \`TermBee_${version}_universal.dmg\``,
    '',
    'These builds are not code-signed yet, so the first launch needs one extra click:',
    '',
    '- **Windows:** if SmartScreen says "Windows protected your PC", click **More info → Run anyway**.',
    '- **macOS:** open the .dmg and drag TermBee to Applications. On first launch, if macOS',
    '  blocks it, open **System Settings → Privacy & Security** and click **Open Anyway**.',
    '',
    "## What's changed",
    '',
    log || '- First release',
    '',
    previous ? `**Full changelog:** ${repoUrl}/compare/${previous}...${tag}` : '',
  ].join('\n')
  const notesFile = join(tmpdir(), `termbee-${tag}-notes.md`)
  writeFileSync(notesFile, notes)
  run('gh', [
    'release',
    'create',
    tag,
    '--target',
    head,
    '--title',
    `TermBee ${tag}`,
    '--notes-file',
    notesFile,
    ...(draft ? ['--draft'] : []),
  ])
  rmSync(notesFile, { force: true })
} else {
  step(`Release ${tag} exists; adding this platform's installer`)
}

step('Uploading')
run('gh', ['release', 'upload', tag, ...assets, '--clobber'])

console.log(`\n✔ ${tag} is up: ${repoUrl}/releases/tag/${tag}`)
if (draft) console.log('  It is a draft. Publish it on GitHub when both installers are attached.')
