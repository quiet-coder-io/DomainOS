#!/usr/bin/env node
// Ensures better-sqlite3 native binary matches the target runtime.
// Usage: node scripts/ensure-native.mjs node|electron

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

if (process.env.ENSURE_NATIVE_SKIP === '1') process.exit(0)

const target = process.argv[2] ?? 'node'
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const require = createRequire(import.meta.url)

// Windows: npm/npx are .cmd files
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

// ABI mismatch error patterns
const ABI_MISMATCH_PATTERNS = [
  'ERR_DLOPEN_FAILED',
  'was compiled against a different Node.js version',
  'Module did not self-register',
  'NODE_MODULE_VERSION',
]

function isAbiMismatch(err) {
  const msg = String(err?.message ?? err)
  const cause = String(err?.cause?.message ?? '')
  const code = err?.code ?? ''
  return ABI_MISMATCH_PATTERNS.some(p => msg.includes(p) || cause.includes(p) || code.includes(p))
}

// Read Electron version — try hoisted root, workspace, then Node resolution
function getElectronVersion() {
  const paths = [
    resolve(repoRoot, 'node_modules/electron/package.json'),
    resolve(repoRoot, 'apps/desktop/node_modules/electron/package.json'),
  ]
  for (const p of paths) {
    try { return require(p).version } catch { /* try next */ }
  }
  try { return require('electron/package.json').version } catch { return null }
}

// Attempt to load better-sqlite3 native binary in current (system Node) process.
// require('better-sqlite3') only loads the JS wrapper — the native .node binary
// is lazy-loaded via bindings() when constructing a Database instance.
let loadedInSystemNode = false
let loadError = null
try {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.close()
  loadedInSystemNode = true
} catch (err) {
  loadError = err
}

if (target === 'node') {
  if (loadedInSystemNode) {
    console.log('[ensure-native] better-sqlite3 OK for system Node')
    process.exit(0)
  }
  if (isAbiMismatch(loadError)) {
    console.log('[ensure-native] ABI mismatch detected — rebuilding for system Node...')
    execFileSync(npm, ['rebuild', 'better-sqlite3'], { cwd: repoRoot, stdio: 'inherit' })
  } else {
    console.error('[ensure-native] better-sqlite3 failed to load (not an ABI issue):', loadError?.message)
    process.exit(1)
  }
} else if (target === 'electron') {
  // If binary loads in system Node → it's compiled for system Node → wrong for Electron
  if (loadedInSystemNode) {
    console.log('[ensure-native] System Node ABI detected — rebuilding for Electron...')
    const electronVersion = getElectronVersion()
    const args = ['electron-rebuild', '-f', '-w', 'better-sqlite3', '--module-dir', repoRoot]
    if (electronVersion) args.push('-v', electronVersion)
    execFileSync(npx, args, { cwd: repoRoot, stdio: 'inherit' })
  } else if (isAbiMismatch(loadError)) {
    // Fails with ABI error under system Node → likely already Electron ABI
    console.log('[ensure-native] better-sqlite3 OK for Electron (ABI differs from system Node)')
  } else {
    console.error('[ensure-native] better-sqlite3 failed to load (not an ABI issue):', loadError?.message)
    process.exit(1)
  }
} else {
  console.error('[ensure-native] Unknown target:', target, '— use: node | electron')
  process.exit(2)
}
