/**
 * Gmail client for tool-use: search and read messages.
 *
 * Uses OAuth2 with PKCE (no clientSecret). Handles automatic access token
 * refresh via the refresh_token. Only surfaces "reconnect" errors on
 * invalid_grant, revoked token, or missing refresh token.
 */

import { google } from 'googleapis'
import type { gmail_v1 } from 'googleapis'
import { extractTextBody } from './body-parser.js'

export interface GmailClientConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export interface GmailSearchResult {
  messageId: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
}

export interface GmailMessage {
  messageId: string
  threadId: string
  from: string
  to: string[]
  subject: string
  date: string
  body: string
  labels: string[]
}

/** Strip control chars, zero-width chars, and collapse whitespace. */
function sanitizeText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Format a timestamp as a locale-aware string (system timezone, not UTC). */
function formatLocal(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  })
}

function parseDate(headerDate: string, internalDate: string | null | undefined): { iso: string; ts: number } {
  const headerTs = Date.parse(headerDate)
  if (!isNaN(headerTs)) {
    return { iso: formatLocal(headerTs), ts: headerTs }
  }
  if (internalDate) {
    const internalTs = Number(internalDate)
    if (!isNaN(internalTs) && internalTs > 0) {
      return { iso: formatLocal(internalTs), ts: internalTs }
    }
  }
  return { iso: '', ts: 0 }
}

export class GmailClient {
  private gmail: gmail_v1.Gmail

  constructor(config: GmailClientConfig) {
    const auth = new google.auth.OAuth2(config.clientId, config.clientSecret)
    auth.setCredentials({ refresh_token: config.refreshToken })
    this.gmail = google.gmail({ version: 'v1', auth })
  }

  /** Preflight check: validates credentials by fetching profile. */
  async getProfile(): Promise<{ ok: boolean; email?: string }> {
    try {
      const res = await this.gmail.users.getProfile({ userId: 'me' })
      return { ok: true, email: res.data.emailAddress ?? undefined }
    } catch {
      return { ok: false }
    }
  }

  /**
   * Search Gmail messages. Returns metadata for each result.
   * Hard cap maxResults at 20, default 10. Results sorted by date descending.
   */
  async search(query: string, maxResults = 10): Promise<GmailSearchResult[]> {
    const clamped = Math.min(Math.max(1, maxResults), 20)

    const listRes = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: clamped,
    })

    const messageRefs = listRes.data.messages ?? []
    if (messageRefs.length === 0) return []

    // Fetch metadata in batches of 5
    const results: GmailSearchResult[] = []
    for (let i = 0; i < messageRefs.length; i += 5) {
      const batch = messageRefs.slice(i, i + 5)
      const fetched = await Promise.all(
        batch.map(async (ref) => {
          if (!ref.id) return null
          try {
            const res = await this.gmail.users.messages.get({
              userId: 'me',
              id: ref.id,
              format: 'metadata',
              metadataHeaders: ['From', 'To', 'Subject', 'Date'],
            })
            return res.data
          } catch {
            return null
          }
        }),
      )

      for (const msg of fetched) {
        if (!msg || !msg.id) continue
        const headers = msg.payload?.headers ?? []
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

        const rawSubject = getHeader('Subject')
        const subject = rawSubject
          ? sanitizeText(rawSubject).slice(0, 300)
          : '(no subject)'

        const { iso, ts } = parseDate(getHeader('Date'), msg.internalDate)

        const snippet = sanitizeText(msg.snippet ?? '').slice(0, 200)

        results.push({
          messageId: msg.id,
          threadId: msg.threadId ?? '',
          from: sanitizeText(getHeader('From')),
          subject,
          date: iso,
          snippet,
        })
      }
    }

    // Sort by date descending
    results.sort((a, b) => {
      const tsA = Date.parse(a.date) || 0
      const tsB = Date.parse(b.date) || 0
      return tsB - tsA
    })

    return results
  }

  /**
   * Read the full content of a Gmail message by ID.
   * Truncates body to 10,000 chars. Returns headers + body text only.
   */
  async read(messageId: string): Promise<GmailMessage | null> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      })

      const msg = res.data
      if (!msg.id) return null

      const headers = msg.payload?.headers ?? []
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

      const rawSubject = getHeader('Subject')
      const subject = rawSubject
        ? sanitizeText(rawSubject).slice(0, 300)
        : '(no subject)'

      const rawTo = getHeader('To')
      const toList = rawTo
        .split(',')
        .map((s) => sanitizeText(s))
        .filter(Boolean)
      const to = toList.length > 20
        ? [...toList.slice(0, 20), `(+${toList.length - 20} more)`]
        : toList

      const { iso } = parseDate(getHeader('Date'), msg.internalDate)

      let body = extractTextBody(msg.payload)
      if (body.length > 10_000) {
        body = body.slice(0, 10_000) + '\n[truncated]'
      }

      return {
        messageId: msg.id,
        threadId: msg.threadId ?? '',
        from: sanitizeText(getHeader('From')),
        to,
        subject,
        date: iso,
        body,
        labels: msg.labelIds ?? [],
      }
    } catch {
      return null
    }
  }
}
