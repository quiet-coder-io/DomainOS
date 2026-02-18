import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildSiblingContext } from '../../src/kb/context-builder.js'

const testDir = join(tmpdir(), 'dos-sibling-test-' + Date.now())
let siblingAPath: string
let siblingBPath: string
let siblingCPath: string

beforeEach(async () => {
  siblingAPath = join(testDir, 'sibling-a')
  siblingBPath = join(testDir, 'sibling-b')
  siblingCPath = join(testDir, 'sibling-c')
  await mkdir(siblingAPath, { recursive: true })
  await mkdir(siblingBPath, { recursive: true })
  await mkdir(siblingCPath, { recursive: true })
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('buildSiblingContext', () => {
  it('returns digest contents for siblings with kb_digest.md', async () => {
    await writeFile(join(siblingAPath, 'kb_digest.md'), 'Digest for A')
    await writeFile(join(siblingBPath, 'kb_digest.md'), 'Digest for B')

    const result = await buildSiblingContext(
      [
        { domainName: 'Sibling A', kbPath: siblingAPath },
        { domainName: 'Sibling B', kbPath: siblingBPath },
      ],
      1500,
      4000,
    )
    expect(result).toHaveLength(2)
    expect(result[0].domainName).toBe('Sibling A')
    expect(result[0].digestContent).toBe('Digest for A')
    expect(result[1].domainName).toBe('Sibling B')
    expect(result[1].digestContent).toBe('Digest for B')
  })

  it('skips siblings without kb_digest.md', async () => {
    await writeFile(join(siblingAPath, 'kb_digest.md'), 'Digest A')
    // siblingB has no digest file

    const result = await buildSiblingContext(
      [
        { domainName: 'Sibling A', kbPath: siblingAPath },
        { domainName: 'Sibling B', kbPath: siblingBPath },
      ],
      1500,
      4000,
    )
    expect(result).toHaveLength(1)
    expect(result[0].domainName).toBe('Sibling A')
  })

  it('truncates per-sibling at token cap', async () => {
    // Write a large digest (> 1500 tokens = 6000 chars)
    const largeContent = 'X'.repeat(8000)
    await writeFile(join(siblingAPath, 'kb_digest.md'), largeContent)

    const result = await buildSiblingContext(
      [{ domainName: 'Sibling A', kbPath: siblingAPath }],
      1500, // 1500 tokens = 6000 chars
      4000,
    )
    expect(result).toHaveLength(1)
    // Content should be truncated at 6000 chars + truncation marker
    expect(result[0].digestContent.length).toBeLessThan(8000)
    expect(result[0].digestContent).toContain('...[TRUNCATED]')
  })

  it('drops siblings that exceed global cap', async () => {
    // Each digest is 2000 chars = 500 tokens. Global cap = 1000 tokens = 4000 chars.
    // A (2000) + B (2000) = 4000 fits. C would exceed.
    await writeFile(join(siblingAPath, 'kb_digest.md'), 'A'.repeat(2000))
    await writeFile(join(siblingBPath, 'kb_digest.md'), 'B'.repeat(2000))
    await writeFile(join(siblingCPath, 'kb_digest.md'), 'C'.repeat(2000))

    const result = await buildSiblingContext(
      [
        { domainName: 'Sibling A', kbPath: siblingAPath },
        { domainName: 'Sibling B', kbPath: siblingBPath },
        { domainName: 'Sibling C', kbPath: siblingCPath },
      ],
      1500,
      1000, // 1000 tokens = 4000 chars — fits A and B, drops C
    )
    expect(result).toHaveLength(2)
    expect(result[0].domainName).toBe('Sibling A')
    expect(result[1].domainName).toBe('Sibling B')
  })

  it('returns empty array when no siblings provided', async () => {
    const result = await buildSiblingContext([], 1500, 4000)
    expect(result).toEqual([])
  })
})
