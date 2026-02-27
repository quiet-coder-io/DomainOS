#!/usr/bin/env node
/**
 * Packaging wrapper for electron-builder in an npm workspaces monorepo.
 *
 * Problem: electron-builder follows workspace symlinks (e.g. node_modules/@domain-os/core
 * → ../../packages/core) and fails because the real path is outside apps/desktop/.
 *
 * Solution: temporarily strip workspace deps from package.json before electron-builder
 * runs. These packages are already bundled by electron-vite (via the `exclude` option in
 * externalizeDepsPlugin), so they don't need to be in node_modules at runtime.
 *
 * Usage: node scripts/package.mjs [electron-builder flags...]
 *   e.g. node scripts/package.mjs --mac --arm64
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')
const backupPath = pkgPath + '.bak'

const WORKSPACE_DEPS = ['@domain-os/core', '@domain-os/integrations']

// Read original
const original = readFileSync(pkgPath, 'utf-8')
const pkg = JSON.parse(original)

// Strip workspace deps
for (const dep of WORKSPACE_DEPS) {
  delete pkg.dependencies?.[dep]
  delete pkg.devDependencies?.[dep]
}

// Write modified + backup
writeFileSync(backupPath, original)
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

const args = process.argv.slice(2)

try {
  execFileSync('npx', ['electron-builder', ...args, '--config', 'electron-builder.yml'], {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
  })
} finally {
  // Always restore original
  writeFileSync(pkgPath, original)
  if (existsSync(backupPath)) unlinkSync(backupPath)
}
