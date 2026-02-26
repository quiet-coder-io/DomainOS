import { describe, it, expect } from 'vitest'
import { extractAttachmentMeta } from '../src/gmail/body-parser.js'
import type { gmail_v1 } from 'googleapis'

function makePart(overrides: Partial<gmail_v1.Schema$MessagePart> = {}): gmail_v1.Schema$MessagePart {
  return {
    mimeType: 'application/pdf',
    filename: 'report.pdf',
    body: { attachmentId: 'att-1', size: 1234 },
    ...overrides,
  }
}

function makeMultipart(
  parts: gmail_v1.Schema$MessagePart[],
  mimeType = 'multipart/mixed',
): gmail_v1.Schema$MessagePart {
  return { mimeType, parts, body: {} }
}

describe('extractAttachmentMeta', () => {
  it('returns empty for undefined payload', () => {
    expect(extractAttachmentMeta(undefined)).toEqual([])
  })

  it('extracts a single PDF attachment', () => {
    const payload = makeMultipart([
      { mimeType: 'text/plain', body: { data: 'aGVsbG8=' } },
      makePart(),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      attachmentId: 'att-1',
      inlineData: null,
    })
  })

  it('extracts multiple attachments in MIME order', () => {
    const payload = makeMultipart([
      { mimeType: 'text/plain', body: { data: 'dGV4dA==' } },
      makePart({ filename: 'first.pdf', body: { attachmentId: 'a1', size: 100 } }),
      makePart({ filename: 'second.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: { attachmentId: 'a2', size: 200 } }),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(2)
    expect(result[0].filename).toBe('first.pdf')
    expect(result[1].filename).toBe('second.xlsx')
  })

  it('synthesizes filename for unnamed part with supported mimeType', () => {
    const payload = makeMultipart([
      makePart({ filename: '', mimeType: 'application/pdf', body: { attachmentId: 'a1', size: 50 } }),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toMatch(/^attachment-\d+\.pdf$/)
  })

  it('skips unnamed part with unsupported mimeType', () => {
    const payload = makeMultipart([
      makePart({ filename: '', mimeType: 'image/png', body: { attachmentId: 'a1', size: 50 } }),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(0)
  })

  it('skips multipart/* container parts', () => {
    const payload = makeMultipart([
      makeMultipart([
        makePart({ filename: 'nested.pdf', body: { attachmentId: 'n1', size: 300 } }),
      ], 'multipart/alternative'),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('nested.pdf')
  })

  it('skips message/rfc822 (forwarded email)', () => {
    const payload = makeMultipart([
      { mimeType: 'message/rfc822', filename: 'forwarded.eml', body: { attachmentId: 'fwd', size: 5000 } },
      makePart({ filename: 'real.pdf', body: { attachmentId: 'r1', size: 100 } }),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('real.pdf')
  })

  it('skips ghost parts (no attachmentId AND no inlineData)', () => {
    const payload = makeMultipart([
      makePart({ filename: 'ghost.pdf', body: { size: 100 } }),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(0)
  })

  it('handles deeply nested multipart structures', () => {
    const payload = makeMultipart([
      makeMultipart([
        makeMultipart([
          makePart({ filename: 'deep.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: { attachmentId: 'd1', size: 400 } }),
        ]),
      ]),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('deep.docx')
  })

  it('handles inline data (no attachmentId)', () => {
    const payload = makeMultipart([
      makePart({ filename: 'inline.pdf', body: { data: 'AAAA', size: 3 } }),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result).toHaveLength(1)
    expect(result[0].attachmentId).toBeNull()
    expect(result[0].inlineData).toBe('AAAA')
  })

  it('strips surrounding quotes from filename', () => {
    const payload = makeMultipart([
      makePart({ filename: '"report.pdf"', body: { attachmentId: 'q1', size: 100 } }),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result[0].filename).toBe('report.pdf')
  })

  it('strips query/fragment from filename', () => {
    const payload = makeMultipart([
      makePart({ filename: 'report.pdf?x=1#y', body: { attachmentId: 'qf1', size: 100 } }),
    ])
    const result = extractAttachmentMeta(payload)
    expect(result[0].filename).toBe('report.pdf')
  })
})
