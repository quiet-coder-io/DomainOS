/**
 * KB file scaffolding.
 * Creates starter claude.md, kb_digest.md, and kb_intel.md files
 * in a target directory for new domain setup.
 */

import { writeFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Result } from '../common/result.js'
import { Ok, Err } from '../common/result.js'
import { DomainOSError } from '../common/errors.js'

export interface ScaffoldInput {
  dirPath: string
  domainName: string
}

export interface ScaffoldFileResult {
  filename: string
  status: 'created' | 'skipped'
}

export interface ScaffoldResult {
  files: ScaffoldFileResult[]
  createdCount: number
  skippedCount: number
}

/** Template definitions for the three core KB files. */
export const KB_TEMPLATES: Array<{
  filename: string
  content: (name: string, date: string) => string
}> = [
  {
    filename: 'claude.md',
    content: (name) =>
      `# ${name} — CLAUDE.md

<!-- This file controls agent behavior for this domain. -->

## Role & Identity
<!-- Define this agent's role, expertise, tone, and strategic thinking. -->

## Key Rules
<!-- Non-negotiable rules this agent must always follow. -->

## Operating Boundaries
<!-- What this agent should and should not do. -->
`,
  },
  {
    filename: 'kb_digest.md',
    content: (name, date) =>
      `# ${name} — KB Digest

## STATUS
**Last updated:** ${date}
<!-- Current status, active workstreams, and near-term priorities. -->

## CRITICAL ITEMS
<!-- [CRITICAL] and [HIGH] items requiring attention. Remove when resolved. -->

## CHANGE_LOG
### ${date} — Domain Created
- Initial KB scaffolding
`,
  },
  {
    filename: 'kb_intel.md',
    content: (name) =>
      `# ${name} — KB Intel

## Key Contacts
<!-- People, organizations, and their roles relevant to this domain. -->

## Reference Data
<!-- Standing data: account numbers, URLs, important thresholds. -->

## Decision History
<!-- Past decisions with rationale. Newest first. -->
`,
  },
]

/**
 * Create starter KB files in a directory. Existing files are never overwritten.
 *
 * 1. Resolves the directory path (realpath) and verifies it's a directory.
 * 2. Writes each template file with exclusive create flag (`wx`).
 * 3. Returns per-file status (created/skipped) and aggregate counts.
 */
export async function scaffoldKBFiles(
  input: ScaffoldInput,
): Promise<Result<ScaffoldResult, DomainOSError>> {
  let resolved: string
  try {
    resolved = await realpath(input.dirPath)
  } catch {
    return Err(DomainOSError.io(`Directory does not exist: ${input.dirPath}`))
  }

  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) {
      return Err(DomainOSError.io(`Path is not a directory: ${input.dirPath}`))
    }
  } catch {
    return Err(DomainOSError.io(`Cannot access path: ${input.dirPath}`))
  }

  const date = new Date().toISOString().slice(0, 10)
  const files: ScaffoldFileResult[] = []

  for (const tpl of KB_TEMPLATES) {
    const fullPath = join(resolved, tpl.filename)
    try {
      await writeFile(fullPath, tpl.content(input.domainName, date), { flag: 'wx' })
      files.push({ filename: tpl.filename, status: 'created' })
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        files.push({ filename: tpl.filename, status: 'skipped' })
      } else {
        return Err(
          DomainOSError.io(
            `Cannot write ${tpl.filename}: ${code ?? 'unknown error'}` +
              (files.length > 0
                ? ` (${files.length} file(s) may have been created before this error)`
                : ''),
          ),
        )
      }
    }
  }

  const createdCount = files.filter((f) => f.status === 'created').length
  const skippedCount = files.filter((f) => f.status === 'skipped').length

  return Ok({ files, createdCount, skippedCount })
}
