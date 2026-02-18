import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { v4 as uuidv4 } from 'uuid'
import { buildKBContext, buildSiblingContext } from '../../src/kb/context-builder.js'
import type { KBFile } from '../../src/kb/schemas.js'

describe('buildKBContext', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kb-context-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  function makeKBFile(relativePath: string, tier?: string): KBFile {
    return {
      id: uuidv4(),
      domainId: uuidv4(),
      relativePath,
      contentHash: 'unused',
      sizeBytes: 0,
      lastSyncedAt: new Date().toISOString(),
      tier: (tier ?? 'general') as KBFile['tier'],
      tierSource: 'inferred',
    }
  }

  it('truncates when budget is exceeded', async () => {
    await writeFile(join(tempDir, 'a.md'), 'A'.repeat(100))
    await writeFile(join(tempDir, 'b.md'), 'B'.repeat(100))
    await writeFile(join(tempDir, 'c.md'), 'C'.repeat(100))

    const files = [makeKBFile('a.md'), makeKBFile('b.md'), makeKBFile('c.md')]

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

  it('sorts by tier priority: structural before general', async () => {
    await writeFile(join(tempDir, 'zebra.md'), 'General content')
    await writeFile(join(tempDir, 'claude.md'), 'Structural content')

    const files = [
      makeKBFile('zebra.md', 'general'),
      makeKBFile('claude.md', 'structural'),
    ]

    const result = await buildKBContext(tempDir, files, 10000)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Structural (root claude.md) should be first
    expect(result.value.files[0].path).toBe('claude.md')
    expect(result.value.files[0].tier).toBe('structural')
  })

  it('reclassifies nested claude.md as general even if DB says structural', async () => {
    await writeFile(join(tempDir, 'notes.md'), 'General content')
    await mkdir(join(tempDir, 'sub'))
    await writeFile(join(tempDir, 'sub', 'claude.md'), 'Nested structural')

    const files = [
      makeKBFile('notes.md', 'general'),
      makeKBFile(join('sub', 'claude.md'), 'structural'), // stale DB tier
    ]

    const result = await buildKBContext(tempDir, files, 10000)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const nested = result.value.files.find((f) => f.path === join('sub', 'claude.md'))
    expect(nested?.tier).toBe('general')
  })

  it('includes tier and staleness labels in returned files', async () => {
    await writeFile(join(tempDir, 'test.md'), 'Test content')

    const files = [makeKBFile('test.md', 'general')]

    const result = await buildKBContext(tempDir, files, 10000)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.files[0].tier).toBe('general')
    expect(result.value.files[0].stalenessLabel).toBeDefined()
    expect(result.value.files[0].stalenessLabel).toContain('[FRESH]')
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

  it('truncates last file content when it partially fits', async () => {
    // File A content: small enough to include
    await writeFile(join(tempDir, 'a.md'), 'Small')
    // File B content: too large for remaining budget
    await writeFile(join(tempDir, 'b.md'), 'X'.repeat(500))

    const files = [makeKBFile('a.md'), makeKBFile('b.md')]

    // Budget for ~1.5 files
    const result = await buildKBContext(tempDir, files, 50)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Both files included — second one truncated
    expect(result.value.truncated).toBe(true)
    if (result.value.files.length === 2) {
      expect(result.value.files[1].content).toContain('...[TRUNCATED]')
    }
  })
})

describe('buildSiblingContext', () => {
  let tempDirA: string
  let tempDirB: string
  let tempDirC: string

  beforeEach(async () => {
    tempDirA = await mkdtemp(join(tmpdir(), 'sibling-a-'))
    tempDirB = await mkdtemp(join(tmpdir(), 'sibling-b-'))
    tempDirC = await mkdtemp(join(tmpdir(), 'sibling-c-'))
  })

  afterEach(async () => {
    await rm(tempDirA, { recursive: true, force: true })
    await rm(tempDirB, { recursive: true, force: true })
    await rm(tempDirC, { recursive: true, force: true })
  })

  it('reads kb_digest.md from each sibling', async () => {
    await writeFile(join(tempDirA, 'kb_digest.md'), 'Digest A')
    await writeFile(join(tempDirB, 'kb_digest.md'), 'Digest B')

    const result = await buildSiblingContext(
      [
        { domainName: 'A', kbPath: tempDirA },
        { domainName: 'B', kbPath: tempDirB },
      ],
      1500,
      4000,
    )

    expect(result).toHaveLength(2)
    expect(result[0].domainName).toBe('A')
    expect(result[0].digestContent).toBe('Digest A')
  })

  it('skips siblings without kb_digest.md', async () => {
    await writeFile(join(tempDirA, 'kb_digest.md'), 'Digest A')
    // B has no digest

    const result = await buildSiblingContext(
      [
        { domainName: 'A', kbPath: tempDirA },
        { domainName: 'B', kbPath: tempDirB },
      ],
      1500,
      4000,
    )

    expect(result).toHaveLength(1)
    expect(result[0].domainName).toBe('A')
  })

  it('truncates per-sibling content at cap', async () => {
    const longContent = 'X'.repeat(10000)
    await writeFile(join(tempDirA, 'kb_digest.md'), longContent)

    const result = await buildSiblingContext(
      [{ domainName: 'A', kbPath: tempDirA }],
      50, // 50 tokens = 200 chars
      4000,
    )

    expect(result).toHaveLength(1)
    expect(result[0].digestContent.length).toBeLessThan(longContent.length)
    expect(result[0].digestContent).toContain('...[TRUNCATED]')
  })

  it('drops entire sibling when global cap exceeded', async () => {
    await writeFile(join(tempDirA, 'kb_digest.md'), 'A'.repeat(100))
    await writeFile(join(tempDirB, 'kb_digest.md'), 'B'.repeat(100))
    await writeFile(join(tempDirC, 'kb_digest.md'), 'C'.repeat(100))

    const result = await buildSiblingContext(
      [
        { domainName: 'A', kbPath: tempDirA },
        { domainName: 'B', kbPath: tempDirB },
        { domainName: 'C', kbPath: tempDirC },
      ],
      1500,
      50, // 50 tokens = 200 chars = fits ~2 siblings
    )

    expect(result.length).toBeLessThan(3)
  })
})
