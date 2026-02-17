import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanKBDirectory } from '../../src/kb/scanner.js'

describe('scanKBDirectory', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kb-scanner-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('finds all .md files recursively', async () => {
    await writeFile(join(tempDir, 'root.md'), '# Root')
    await mkdir(join(tempDir, 'sub'))
    await writeFile(join(tempDir, 'sub', 'nested.md'), '# Nested')

    const result = await scanKBDirectory(tempDir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const paths = result.value.map((f) => f.relativePath).sort()
    expect(paths).toEqual(['root.md', join('sub', 'nested.md')])
  })

  it('computes correct SHA-256 hashes', async () => {
    const content = '# Hello World'
    await writeFile(join(tempDir, 'test.md'), content)
    const expectedHash = createHash('sha256').update(content).digest('hex')

    const result = await scanKBDirectory(tempDir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toHaveLength(1)
    expect(result.value[0].hash).toBe(expectedHash)
  })

  it('excludes non-.md files', async () => {
    await writeFile(join(tempDir, 'notes.md'), '# Notes')
    await writeFile(join(tempDir, 'data.json'), '{}')
    await writeFile(join(tempDir, 'readme.txt'), 'hello')

    const result = await scanKBDirectory(tempDir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toHaveLength(1)
    expect(result.value[0].relativePath).toBe('notes.md')
  })

  it('returns Err for missing directory', async () => {
    const result = await scanKBDirectory('/tmp/nonexistent-dir-abc123')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.code).toBe('IO_ERROR')
  })

  it('reports correct file sizes', async () => {
    const content = 'Some content here'
    await writeFile(join(tempDir, 'sized.md'), content)

    const result = await scanKBDirectory(tempDir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value[0].sizeBytes).toBe(Buffer.byteLength(content))
  })

  it('sets absolutePath correctly', async () => {
    await writeFile(join(tempDir, 'abs.md'), '# Abs')

    const result = await scanKBDirectory(tempDir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value[0].absolutePath).toBe(join(tempDir, 'abs.md'))
  })
})
