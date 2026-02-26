/**
 * Shared utility for extracting plain text from Gmail message payloads.
 *
 * Recursively walks multipart MIME structures, prioritizing text/plain.
 * Used by both GmailPoller (intake) and GmailClient (tool-use).
 */

import type { gmail_v1 } from 'googleapis'

export interface GmailAttachmentMeta {
  filename: string
  mimeType: string
  size: number               // part.body.size (advisory only — NOT authoritative)
  attachmentId: string | null // null = inline data available
  inlineData: string | null   // base64url string when body.data present
}

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

export function extractAttachmentMeta(
  payload: gmail_v1.Schema$MessagePart | undefined,
): GmailAttachmentMeta[] {
  const results: GmailAttachmentMeta[] = []
  if (!payload) return results

  function walk(part: gmail_v1.Schema$MessagePart, partIndex: number): void {
    const mimeType = part.mimeType ?? ''

    // Skip multipart containers — recurse into their children
    if (mimeType.startsWith('multipart/')) {
      if (part.parts) {
        for (let i = 0; i < part.parts.length; i++) {
          walk(part.parts[i], i)
        }
      }
      return
    }

    // Skip forwarded emails (v2 scope)
    if (mimeType === 'message/rfc822') return

    const attachmentId = part.body?.attachmentId ?? null
    const inlineData = part.body?.data ?? null

    // Must have a data source — skip "ghost parts"
    if (!attachmentId && !inlineData) {
      // But still recurse into sub-parts if any
      if (part.parts) {
        for (let i = 0; i < part.parts.length; i++) {
          walk(part.parts[i], i)
        }
      }
      return
    }

    // Sanitize filename: trim, strip quotes, strip query/fragment
    let clean = (part.filename ?? '').trim().replace(/^"|"$/g, '').split(/[?#]/)[0]

    // Synthesize filename for unnamed parts with supported mimeType
    if (!clean && MIME_TO_EXT[mimeType.toLowerCase()]) {
      clean = `attachment-${partIndex}.${MIME_TO_EXT[mimeType.toLowerCase()]}`
    }

    // Skip truly unnamed + unsupported
    if (!clean) {
      if (part.parts) {
        for (let i = 0; i < part.parts.length; i++) {
          walk(part.parts[i], i)
        }
      }
      return
    }

    // Only collect parts that look like real attachments (have filename or synthesized name)
    results.push({
      filename: clean,
      mimeType,
      size: part.body?.size ?? 0,
      attachmentId,
      inlineData,
    })
  }

  // Start walk from the top-level payload
  if (payload.mimeType?.startsWith('multipart/') && payload.parts) {
    for (let i = 0; i < payload.parts.length; i++) {
      walk(payload.parts[i], i)
    }
  } else {
    walk(payload, 0)
  }

  return results
}

export function extractTextBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return ''

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextBody(part)
      if (text) return text
    }
  }

  return ''
}
