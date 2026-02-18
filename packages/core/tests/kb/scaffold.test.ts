import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scaffoldKBFiles } from '../../src/kb/scaffold.js'

describe('scaffoldKBFiles', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kb-scaffold-'))
  })

  afterEach(async () => {
    // Restore permissions before cleanup (test 9 may have changed them)
    try {
      await chmod(tempDir, 0o755)
    } catch {
      // already removed or inaccessible
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates all 3 files in empty directory with correct counts', async () => {
    const result = await scaffoldKBFiles({ dirPath: tempDir, domainName: 'TestDomain' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.files).toHaveLength(3)
    expect(result.value.createdCount).toBe(3)
    expect(result.value.skippedCount).toBe(0)

    const filenames = result.value.files.map((f) => f.filename)
    expect(filenames).toEqual(['claude.md', 'kb_digest.md', 'kb_intel.md'])
    expect(result.value.files.every((f) => f.status === 'created')).toBe(true)
  })

  it('claude.md contains domain name, Role & Identity, and behavior hint', async () => {
    await scaffoldKBFiles({ dirPath: tempDir, domainName: 'Acme Corp' })

    const content = await readFile(join(tempDir, 'claude.md'), 'utf-8')
    expect(content).toContain('Acme Corp')
    expect(content).toContain('Role & Identity')
    expect(content).toContain('This file controls agent behavior')
  })

  it('kb_digest.md contains STATUS, CHANGE_LOG, and today\'s date', async () => {
    await scaffoldKBFiles({ dirPath: tempDir, domainName: 'Finance' })

    const content = await readFile(join(tempDir, 'kb_digest.md'), 'utf-8')
    const today = new Date().toISOString().slice(0, 10)
    expect(content).toContain('STATUS')
    expect(content).toContain('CHANGE_LOG')
    expect(content).toContain(today)
  })

  it('kb_intel.md contains Key Contacts, Reference Data, Decision History', async () => {
    await scaffoldKBFiles({ dirPath: tempDir, domainName: 'Ops' })

    const content = await readFile(join(tempDir, 'kb_intel.md'), 'utf-8')
    expect(content).toContain('Key Contacts')
    expect(content).toContain('Reference Data')
    expect(content).toContain('Decision History')
  })

  it('skips existing file without overwriting (sentinel preserved)', async () => {
    const sentinel = 'SENTINEL_DO_NOT_OVERWRITE'
    await writeFile(join(tempDir, 'claude.md'), sentinel)

    const result = await scaffoldKBFiles({ dirPath: tempDir, domainName: 'Test' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const claudeFile = result.value.files.find((f) => f.filename === 'claude.md')
    expect(claudeFile?.status).toBe('skipped')
    expect(result.value.createdCount).toBe(2)
    expect(result.value.skippedCount).toBe(1)

    const content = await readFile(join(tempDir, 'claude.md'), 'utf-8')
    expect(content).toBe(sentinel)
  })

  it('all 3 skipped when all already exist', async () => {
    await writeFile(join(tempDir, 'claude.md'), 'existing')
    await writeFile(join(tempDir, 'kb_digest.md'), 'existing')
    await writeFile(join(tempDir, 'kb_intel.md'), 'existing')

    const result = await scaffoldKBFiles({ dirPath: tempDir, domainName: 'Test' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.createdCount).toBe(0)
    expect(result.value.skippedCount).toBe(3)
  })

  it('returns Err for nonexistent directory', async () => {
    const result = await scaffoldKBFiles({
      dirPath: '/tmp/nonexistent-scaffold-dir-abc123',
      domainName: 'Test',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('IO_ERROR')
  })

  it('returns Err when path is a file, not a directory', async () => {
    const filePath = join(tempDir, 'not-a-dir.txt')
    await writeFile(filePath, 'hello')

    const result = await scaffoldKBFiles({ dirPath: filePath, domainName: 'Test' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('IO_ERROR')
    expect(result.error.message).toContain('not a directory')
  })

  it.skipIf(process.platform === 'win32')(
    'returns Err with IO_ERROR for read-only directory',
    async () => {
      await chmod(tempDir, 0o444)

      const result = await scaffoldKBFiles({ dirPath: tempDir, domainName: 'Test' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('IO_ERROR')

      // Restore for cleanup
      await chmod(tempDir, 0o755)
    },
  )
})
