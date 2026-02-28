#!/usr/bin/env node
/**
 * Pre-package gate: verifies user-facing documentation versions match package.json.
 *
 * Catches documentation drift before it ships. Run automatically by the package
 * scripts, or manually: node scripts/check-docs-version.mjs
 *
 * Checks:
 *  1. help.html header + footer contain the current version
 *  2. ROADMAP.md "Last updated" reflects the current month
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')
const repoRoot = resolve(desktopRoot, '..', '..')

const pkg = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf-8'))
const version = pkg.version

const errors = []

// ── 1. help.html version check ──────────────────────────────────

const helpPath = resolve(desktopRoot, 'resources', 'help.html')
let helpHtml
try {
  helpHtml = readFileSync(helpPath, 'utf-8')
} catch {
  errors.push(`help.html not found at ${helpPath}`)
}

if (helpHtml) {
  // Header: "Version X.Y.Z"
  if (!helpHtml.includes(`Version ${version}`)) {
    errors.push(
      `help.html header version mismatch — expected "Version ${version}". ` +
        `Update the <p class="subtitle"> line.`,
    )
  }

  // Footer: "DomainOS vX.Y.Z"
  if (!helpHtml.includes(`DomainOS v${version}`)) {
    errors.push(
      `help.html footer version mismatch — expected "DomainOS v${version}". ` +
        `Update the footer <p> near the end of the file.`,
    )
  }
}

// ── 2. ROADMAP.md freshness check ───────────────────────────────

const roadmapPath = resolve(repoRoot, 'ROADMAP.md')
let roadmap
try {
  roadmap = readFileSync(roadmapPath, 'utf-8')
} catch {
  // ROADMAP is optional — skip silently
}

if (roadmap) {
  const now = new Date()
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  if (!roadmap.includes(monthYear)) {
    errors.push(
      `ROADMAP.md "Last updated" doesn't reflect the current month (${monthYear}). ` +
        `Update the line near the top.`,
    )
  }
}

// ── Report ──────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error('\n\x1b[31m✘ Documentation version check failed:\x1b[0m\n')
  for (const err of errors) {
    console.error(`  • ${err}`)
  }
  console.error(
    '\n  Fix the above before packaging. Docs must match package.json version ' +
      `(${version}).\n`,
  )
  process.exit(1)
} else {
  console.log(`\x1b[32m✔\x1b[0m Documentation versions match (v${version})`)
}
