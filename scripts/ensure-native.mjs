#!/usr/bin/env node
// Ensures better-sqlite3 native binary matches the target runtime.
// Usage: node scripts/ensure-native.mjs node|electron

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  const electronVersion = getElectronVersion()
  if (!electronVersion) {
    console.error('[ensure-native] Cannot find Electron version — is electron installed?')
    process.exit(1)
  }

  // Check binary architecture matches process.arch (arm64/x64).
  // Prevents false "OK for Electron" when binary is wrong arch but also fails in system Node.
  const binaryPath = resolve(repoRoot, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  let archOk = false
  try {
    if (existsSync(binaryPath)) {
      const result = execFileSync('file', [binaryPath], { encoding: 'utf8' })
      const expectedArch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
      archOk = result.includes(expectedArch)
      if (!archOk) {
        console.log(`[ensure-native] Architecture mismatch — binary is not ${expectedArch}, rebuilding for Electron ${electronVersion}...`)
      }
    }
  } catch { /* file command failed — proceed to other checks */ }

  // If binary loads in system Node → it's compiled for system Node → wrong for Electron
  // Also rebuild if architecture doesn't match
  if (loadedInSystemNode || !archOk) {
    if (loadedInSystemNode) {
      console.log(`[ensure-native] System Node ABI detected — rebuilding for Electron ${electronVersion}...`)
    }
    // Use node-gyp directly with Electron headers. electron-rebuild silently
    // produces system-Node binaries when system Node ABI > Electron's ABI.
    const sqliteDir = resolve(repoRoot, 'node_modules/better-sqlite3')
    execFileSync(npx, [
      'node-gyp', 'rebuild',
      `--directory=${sqliteDir}`,
      '--runtime=electron',
      `--target=${electronVersion}`,
      '--dist-url=https://electronjs.org/headers',
    ], { cwd: repoRoot, stdio: 'inherit' })

    // Verify the rebuild actually changed the ABI.
    // Must use a child process — require cache still holds the old binary.
    const verifyScript = `try { const D = require('better-sqlite3'); new D(':memory:').close(); process.exit(1); } catch { process.exit(0); }`
    try {
      execFileSync(process.execPath, ['-e', verifyScript], { cwd: repoRoot, stdio: 'ignore' })
      console.log('[ensure-native] better-sqlite3 rebuilt for Electron ✓')
    } catch {
      console.error('[ensure-native] ERROR: binary still loads in system Node after rebuild — ABI unchanged')
      process.exit(1)
    }
  } else if (isAbiMismatch(loadError)) {
    // Fails with ABI error under system Node + arch matches → already Electron ABI
    console.log('[ensure-native] better-sqlite3 OK for Electron (ABI differs from system Node)')
  } else {
    console.error('[ensure-native] better-sqlite3 failed to load (not an ABI issue):', loadError?.message)
    process.exit(1)
  }
} else {
  console.error('[ensure-native] Unknown target:', target, '— use: node | electron')
  process.exit(2)
}
