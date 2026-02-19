/**
 * Shared utility for extracting plain text from Gmail message payloads.
 *
 * Recursively walks multipart MIME structures, prioritizing text/plain.
 * Used by both GmailPoller (intake) and GmailClient (tool-use).
 */

import type { gmail_v1 } from 'googleapis'

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
