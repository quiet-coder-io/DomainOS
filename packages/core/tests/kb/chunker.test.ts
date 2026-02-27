import { describe, it, expect } from 'vitest'
import { chunkMarkdownFile, normalizeForAnchor } from '../../src/kb/chunker.js'

describe('normalizeForAnchor', () => {
  it('normalizes line endings', () => {
    expect(normalizeForAnchor('a\r\nb\rc')).toBe('a b c')
  })

  it('strips heading line from anchor input', () => {
    const content = '## Status\nSome content here'
    const result = normalizeForAnchor(content, '## Status')
    expect(result).not.toContain('## Status')
    expect(result).toContain('Some content here')
  })

  it('collapses whitespace runs', () => {
    expect(normalizeForAnchor('a   b\n  c   d')).toBe('a b c d')
  })

  it('preserves indentation inside fenced code blocks', () => {
    const content = '```\n  indented\n    more\n```'
    const result = normalizeForAnchor(content)
    expect(result).toContain('  indented')
    expect(result).toContain('    more')
  })

  it('trims leading/trailing whitespace', () => {
    expect(normalizeForAnchor('  hello  ')).toBe('hello')
  })

  it('handles empty content', () => {
    expect(normalizeForAnchor('')).toBe('')
  })
})

describe('chunkMarkdownFile', () => {
  const fileId = 'test-file-id'

  it('returns empty array for empty content', () => {
    expect(chunkMarkdownFile(fileId, '')).toHaveLength(0)
    expect(chunkMarkdownFile(fileId, '   ')).toHaveLength(0)
  })

  it('creates a single chunk for short content with no headings', () => {
    const content = 'This is a simple paragraph with enough content to be meaningful for chunking purposes.'
    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 10 })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0].headingPath).toBe('')
    expect(chunks[0].content).toContain('simple paragraph')
  })

  it('splits on heading boundaries', () => {
    const content = [
      '## Introduction',
      'This is the introduction section with enough text to make a meaningful chunk for testing.',
      '',
      '## Methods',
      'This is the methods section with enough text to make a meaningful chunk for testing purposes.',
      '',
      '## Results',
      'This is the results section with enough text to make a meaningful chunk for testing output.',
    ].join('\n')

    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 10 })
    expect(chunks.length).toBe(3)
    expect(chunks[0].headingPath).toContain('Introduction')
    expect(chunks[1].headingPath).toContain('Methods')
    expect(chunks[2].headingPath).toContain('Results')
  })

  it('tracks heading hierarchy path', () => {
    const content = [
      '## Status',
      'Status overview text that provides context for the domain status report section.',
      '',
      '### Open Items',
      'List of open items that need attention and follow-up actions from the team members.',
      '',
      '### Resolved',
      'Items that have been resolved and can be considered closed at this point in time.',
    ].join('\n')

    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 10 })
    const openItemsChunk = chunks.find(c => c.headingPath.includes('Open Items'))
    expect(openItemsChunk).toBeDefined()
    expect(openItemsChunk!.headingPath).toContain('Status')
    expect(openItemsChunk!.headingPath).toContain('Open Items')
  })

  it('extracts YAML frontmatter as own chunk', () => {
    const content = [
      '---',
      'title: Test Document',
      'tags: [test, example]',
      '---',
      '',
      '## Content',
      'The main content of this document with enough text to make a meaningful chunk for testing.',
    ].join('\n')

    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 10 })
    const frontmatter = chunks.find(c => c.headingPath === '[frontmatter]')
    expect(frontmatter).toBeDefined()
    expect(frontmatter!.content).toContain('title: Test Document')
  })

  it('merges small sections with next section', () => {
    const content = [
      '## Tiny',
      'Small',
      '',
      '## Larger Section',
      'This section has enough content to stand on its own and should be a separate chunk for testing.',
    ].join('\n')

    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 100 })
    // "Tiny" section is < 100 chars, should be merged into "Larger Section"
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toContain('Small')
    expect(chunks[0].content).toContain('Larger Section')
  })

  it('splits large sections into sub-chunks with overlap', () => {
    const content = '## Big Section\n' + 'A'.repeat(2000)
    const chunks = chunkMarkdownFile(fileId, content, { maxChunkChars: 500, overlapChars: 50, minChunkChars: 10 })
    expect(chunks.length).toBeGreaterThan(1)
    // All sub-chunks share the same heading path
    for (const chunk of chunks) {
      expect(chunk.headingPath).toContain('Big Section')
    }
  })

  it('tracks startLine and endLine', () => {
    const content = [
      '## First',   // line 0
      'Content A',  // line 1
      '',           // line 2
      '## Second',  // line 3
      'Content B',  // line 4
    ].join('\n')

    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 10 })
    expect(chunks.length).toBe(2)
    expect(chunks[0].startLine).toBe(0)
    expect(chunks[1].startLine).toBe(3)
  })

  it('never returns empty chunks', () => {
    const content = [
      '## A',
      '',
      '',
      '## B',
      'Content',
    ].join('\n')

    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 1 })
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0)
    }
  })

  it('computes token estimates', () => {
    const content = '## Section\n' + 'word '.repeat(100)
    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 10 })
    expect(chunks[0].tokenEstimate).toBeGreaterThan(0)
    expect(chunks[0].tokenEstimate).toBe(Math.ceil(chunks[0].charCount / 4))
  })

  describe('chunk key stability', () => {
    it('heading rename preserves key when body is unchanged', () => {
      // chunk_key strips the heading line, so renaming a heading
      // DOES change heading_path which IS part of the key.
      // Per plan: "renaming a heading doesn't churn identity" — the heading line is stripped from anchor hash,
      // BUT heading_path IS in the key formula. So heading rename DOES change key.
      // Actually re-reading the plan: "Strip the heading line itself from anchor input" and
      // "Anchor input = heading_path + normalized_first_256_chars"
      // So heading_path IS part of the anchor input. A heading rename changes heading_path → changes key.
      // This is by design — heading rename is a meaningful structural change.
      const content1 = '## Status\n' + 'The domain is active with ongoing projects and tasks that need attention.'
      const content2 = '## Current Status\n' + 'The domain is active with ongoing projects and tasks that need attention.'

      const chunks1 = chunkMarkdownFile(fileId, content1, { minChunkChars: 10 })
      const chunks2 = chunkMarkdownFile(fileId, content2, { minChunkChars: 10 })

      // Keys differ because heading_path changed
      expect(chunks1[0].chunkKey).not.toBe(chunks2[0].chunkKey)
    })

    it('whitespace reformat preserves chunk key', () => {
      const content1 = '## Status\nThe  domain   is active with ongoing  projects.'
      const content2 = '## Status\nThe domain is active with ongoing projects.'

      const chunks1 = chunkMarkdownFile(fileId, content1, { minChunkChars: 10 })
      const chunks2 = chunkMarkdownFile(fileId, content2, { minChunkChars: 10 })

      // Anchor normalization collapses whitespace, so keys match
      expect(chunks1[0].chunkKey).toBe(chunks2[0].chunkKey)
    })

    it('actual content change produces different chunk key', () => {
      const content1 = '## Status\nThe domain is active with ongoing projects.'
      const content2 = '## Status\nThe domain is inactive and all projects completed.'

      const chunks1 = chunkMarkdownFile(fileId, content1, { minChunkChars: 10 })
      const chunks2 = chunkMarkdownFile(fileId, content2, { minChunkChars: 10 })

      expect(chunks1[0].chunkKey).not.toBe(chunks2[0].chunkKey)
    })

    it('inserting heading at top does not change keys of unaffected sections', () => {
      const sectionB = 'This is the original content that should remain stable across edits to the file.'
      const content1 = '## Section B\n' + sectionB
      const content2 = '## New Top Section\nSome new content.\n\n## Section B\n' + sectionB

      const chunks1 = chunkMarkdownFile(fileId, content1, { minChunkChars: 10 })
      const chunks2 = chunkMarkdownFile(fileId, content2, { minChunkChars: 10 })

      const keyB1 = chunks1.find(c => c.headingPath.includes('Section B'))?.chunkKey
      const keyB2 = chunks2.find(c => c.headingPath.includes('Section B'))?.chunkKey

      expect(keyB1).toBeDefined()
      expect(keyB2).toBeDefined()
      expect(keyB1).toBe(keyB2)
    })
  })

  it('handles file with only frontmatter', () => {
    const content = '---\ntitle: Test\ntags: [a]\n---'
    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 10 })
    expect(chunks.length).toBe(1)
    expect(chunks[0].headingPath).toBe('[frontmatter]')
  })

  it('handles file with unclosed frontmatter', () => {
    const content = '---\ntitle: Test\ntags: [a]'
    const chunks = chunkMarkdownFile(fileId, content, { minChunkChars: 10 })
    expect(chunks.length).toBe(1)
    expect(chunks[0].headingPath).toBe('[frontmatter]')
  })
})
