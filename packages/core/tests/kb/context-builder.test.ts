import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { v4 as uuidv4 } from 'uuid'
import { buildKBContext } from '../../src/kb/context-builder.js'
import type { KBFile } from '../../src/kb/schemas.js'

describe('buildKBContext', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kb-context-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  function makeKBFile(relativePath: string): KBFile {
    return {
      id: uuidv4(),
      domainId: uuidv4(),
      relativePath,
      contentHash: 'unused',
      sizeBytes: 0,
      lastSyncedAt: new Date().toISOString(),
    }
  }

  it('truncates when budget is exceeded', async () => {
    await writeFile(join(tempDir, 'a.md'), 'A'.repeat(100))
    await writeFile(join(tempDir, 'b.md'), 'B'.repeat(100))
    await writeFile(join(tempDir, 'c.md'), 'C'.repeat(100))

    const files = [makeKBFile('a.md'), makeKBFile('b.md'), makeKBFile('c.md')]

    // Budget for ~1 file: header (~20 chars) + 100 content = ~120 chars = ~30 tokens
    // But two files would be ~240 chars = ~60 tokens
    const result = await buildKBContext(tempDir, files, 40)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.files.length).toBeLessThan(3)
    expect(result.value.truncated).toBe(true)
  })

  it('includes all files when budget is large enough', async () => {
    await writeFile(join(tempDir, 'a.md'), 'Short A')
    await writeFile(join(tempDir, 'b.md'), 'Short B')

    const files = [makeKBFile('a.md'), makeKBFile('b.md')]

    const result = await buildKBContext(tempDir, files, 10000)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.files).toHaveLength(2)
    expect(result.value.truncated).toBe(false)
  })

  it('prioritizes claude.md and KB_DIGEST.md files', async () => {
    // Create files with different mtimes to ensure ordering is from priority, not mtime
    await writeFile(join(tempDir, 'zebra.md'), 'Last alphabetically')
    // Set old mtime on zebra
    const oldDate = new Date('2020-01-01')
    await utimes(join(tempDir, 'zebra.md'), oldDate, oldDate)

    await writeFile(join(tempDir, 'alpha.md'), 'First alphabetically')

    await mkdir(join(tempDir, 'sub'))
    await writeFile(join(tempDir, 'sub', 'CLAUDE.md'), 'Priority content')

    const files = [
      makeKBFile('zebra.md'),
      makeKBFile('alpha.md'),
      makeKBFile(join('sub', 'CLAUDE.md')),
    ]

    const result = await buildKBContext(tempDir, files, 10000)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // CLAUDE.md should be first regardless of other sorting
    expect(result.value.files[0].path).toBe(join('sub', 'CLAUDE.md'))
  })

  it('sorts non-priority files by newest modification time', async () => {
    await writeFile(join(tempDir, 'old.md'), 'Old file')
    const oldDate = new Date('2020-01-01')
    await utimes(join(tempDir, 'old.md'), oldDate, oldDate)

    await writeFile(join(tempDir, 'new.md'), 'New file')

    const files = [makeKBFile('old.md'), makeKBFile('new.md')]

    const result = await buildKBContext(tempDir, files, 10000)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.files[0].path).toBe('new.md')
    expect(result.value.files[1].path).toBe('old.md')
  })

  it('tracks totalChars accurately', async () => {
    const content = 'Hello world'
    await writeFile(join(tempDir, 'test.md'), content)

    const files = [makeKBFile('test.md')]

    const result = await buildKBContext(tempDir, files, 10000)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const expectedHeader = '--- FILE: test.md ---\n'
    expect(result.value.totalChars).toBe(expectedHeader.length + content.length)
  })

  it('skips files that no longer exist on disk', async () => {
    await writeFile(join(tempDir, 'exists.md'), 'I exist')

    const files = [makeKBFile('exists.md'), makeKBFile('gone.md')]

    const result = await buildKBContext(tempDir, files, 10000)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.files).toHaveLength(1)
    expect(result.value.files[0].path).toBe('exists.md')
  })
})
