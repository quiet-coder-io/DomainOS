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
    const results: Array<GmailSearchResult & { _ts: number }> = []
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
          _ts: ts,
        })
      }
    }

    // Sort by numeric timestamp descending, then strip internal _ts field
    results.sort((a, b) => b._ts - a._ts)
    return results.map(({ _ts, ...rest }) => rest)
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
      return this.extractMessage(res.data)
    } catch {
      return null
    }
  }

  /**
   * Fetch the last 3 messages of a thread, sorted oldest-first.
   * Uses the same sanitization as read() via extractMessage().
   */
  async getThread(threadId: string): Promise<GmailMessage[]> {
    try {
      const res = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      })
      const rawMessages = res.data.messages ?? []
      if (rawMessages.length === 0) return []

      // Sort by internalDate (numeric millis), oldest first
      const sorted = [...rawMessages].sort(
        (a, b) => Number(a.internalDate ?? '0') - Number(b.internalDate ?? '0'),
      )

      // Take last 3 (most recent)
      const tail = sorted.slice(-3)

      return tail
        .map((msg) => this.extractMessage(msg))
        .filter((m): m is GmailMessage => m !== null)
    } catch {
      return []
    }
  }

  /** Shared extraction: headers, sanitization, body truncation (10K), To cap (20). */
  private extractMessage(msg: gmail_v1.Schema$Message): GmailMessage | null {
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
  }
}
