/**
 * KB context builder — assembles file contents into a token-budgeted context.
 */

import { readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { KBFile, KBContext } from './schemas.js'

const PRIORITY_BASENAMES = ['claude.md', 'kb_digest.md']

function isPriorityFile(relativePath: string): boolean {
  return PRIORITY_BASENAMES.includes(basename(relativePath).toLowerCase())
}

interface FileWithMtime {
  file: KBFile
  mtimeMs: number
}

export async function buildKBContext(
  kbPath: string,
  files: KBFile[],
  tokenBudget: number,
): Promise<Result<KBContext, DomainOSError>> {
  try {
    const charBudget = tokenBudget * 4

    // Stat all files to get mtime
    const filesWithMtime: FileWithMtime[] = []
    for (const file of files) {
      try {
        const absPath = join(kbPath, file.relativePath)
        const fileStat = await stat(absPath)
        filesWithMtime.push({ file, mtimeMs: fileStat.mtimeMs })
      } catch {
        // Skip files that can't be stat'd (deleted since scan)
        continue
      }
    }

    // Sort: priority files first, then by newest mtime
    filesWithMtime.sort((a, b) => {
      const aPriority = isPriorityFile(a.file.relativePath)
      const bPriority = isPriorityFile(b.file.relativePath)
      if (aPriority && !bPriority) return -1
      if (!aPriority && bPriority) return 1
      return b.mtimeMs - a.mtimeMs
    })

    const resultFiles: Array<{ path: string; content: string }> = []
    let totalChars = 0
    let truncated = false

    for (const { file } of filesWithMtime) {
      const absPath = join(kbPath, file.relativePath)
      let content: string
      try {
        content = await readFile(absPath, 'utf-8')
      } catch {
        continue
      }

      const header = `--- FILE: ${file.relativePath} ---\n`
      const block = header + content
      const blockChars = block.length

      if (totalChars + blockChars > charBudget) {
        truncated = true
        break
      }

      resultFiles.push({ path: file.relativePath, content })
      totalChars += blockChars
    }

    return Ok({ files: resultFiles, totalChars, truncated })
  } catch (err) {
    return Err(
      DomainOSError.io(
        `Failed to build KB context: ${err instanceof Error ? err.message : String(err)}`,
      ),
    )
  }
}
