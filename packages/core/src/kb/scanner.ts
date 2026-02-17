/**
 * KB directory scanner — recursively finds and hashes .md files.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { KBScannedFile } from './schemas.js'

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  'dist',
  'out',
  'build',
  '.next',
  '.cache',
  'coverage',
  '__pycache__',
])

async function walkMarkdownFiles(dirPath: string): Promise<string[]> {
  const results: string[] = []
  const entries = await readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const nested = await walkMarkdownFiles(fullPath)
      results.push(...nested)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath)
    }
  }

  return results
}

export async function scanKBDirectory(
  dirPath: string,
): Promise<Result<KBScannedFile[], DomainOSError>> {
  try {
    const dirStat = await stat(dirPath)
    if (!dirStat.isDirectory()) {
      return Err(DomainOSError.io(`Not a directory: ${dirPath}`))
    }
  } catch {
    return Err(DomainOSError.io(`Directory not found: ${dirPath}`))
  }

  try {
    const absolutePaths = await walkMarkdownFiles(dirPath)
    const files: KBScannedFile[] = []

    for (const absPath of absolutePaths) {
      const content = await readFile(absPath)
      const hash = createHash('sha256').update(content).digest('hex')
      const fileStat = await stat(absPath)

      files.push({
        relativePath: relative(dirPath, absPath),
        absolutePath: absPath,
        hash,
        sizeBytes: fileStat.size,
      })
    }

    return Ok(files)
  } catch (err) {
    return Err(
      DomainOSError.io(`Failed to scan directory: ${err instanceof Error ? err.message : String(err)}`),
    )
  }
}
