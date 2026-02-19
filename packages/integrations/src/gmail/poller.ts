/**
 * Gmail poller — fetches new messages and posts them to the DomainOS intake endpoint.
 *
 * Uses Google APIs OAuth2 for authentication. Polls on a configurable interval.
 * Deduplicates via external_id (Gmail message ID) before posting.
 */

import { google } from 'googleapis'
import type { gmail_v1 } from 'googleapis'
import { IntakeClient } from '../common/intake-client.js'
import { extractTextBody } from './body-parser.js'
import type { GmailPollerConfig, GmailMessageMeta } from './types.js'

export class GmailPoller {
  private client: IntakeClient
  private gmail: gmail_v1.Gmail
  private timer: ReturnType<typeof setInterval> | null = null
  private config: Required<
    Pick<GmailPollerConfig, 'pollIntervalMs' | 'query' | 'maxResults'>
  > &
    GmailPollerConfig

  constructor(config: GmailPollerConfig) {
    this.config = {
      ...config,
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      query: config.query ?? 'is:unread newer_than:1d',
      maxResults: config.maxResults ?? 20,
    }

    this.client = new IntakeClient(config.intakeUrl, config.intakeToken)

    const auth = new google.auth.OAuth2(config.clientId, config.clientSecret)
    auth.setCredentials({ refresh_token: config.refreshToken })
    this.gmail = google.gmail({ version: 'v1', auth })
  }

  async start(): Promise<void> {
    // Poll immediately on start
    await this.poll()
    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async poll(): Promise<number> {
    let posted = 0

    try {
      const listRes = await this.gmail.users.messages.list({
        userId: 'me',
        q: this.config.query,
        maxResults: this.config.maxResults,
      })

      const messages = listRes.data.messages ?? []

      for (const msg of messages) {
        if (!msg.id) continue

        // Dedup check against intake endpoint
        const exists = await this.client.checkDuplicate('gmail', msg.id)
        if (exists) continue

        const meta = await this.fetchMessageMeta(msg.id)
        if (!meta) continue

        const body = await this.fetchMessageBody(msg.id)

        const result = await this.client.post({
          title: meta.subject || '(No subject)',
          content: body || meta.snippet || '',
          sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${meta.threadId}`,
          sourceType: 'gmail',
          externalId: meta.messageId,
          metadata: {
            from: meta.from,
            to: meta.to,
            subject: meta.subject,
            date: meta.date,
            threadId: meta.threadId,
            labels: meta.labels,
          },
        })

        if (result.ok) posted++
      }
    } catch (e) {
      console.error('[GmailPoller] poll error:', (e as Error).message)
    }

    return posted
  }

  private async fetchMessageMeta(messageId: string): Promise<GmailMessageMeta | null> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      })

      const headers = res.data.payload?.headers ?? []
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

      return {
        messageId: res.data.id ?? messageId,
        threadId: res.data.threadId ?? '',
        from: getHeader('From'),
        to: getHeader('To')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        labels: res.data.labelIds ?? [],
        snippet: res.data.snippet ?? '',
      }
    } catch {
      return null
    }
  }

  private async fetchMessageBody(messageId: string): Promise<string> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      })

      return extractTextBody(res.data.payload) || res.data.snippet || ''
    } catch {
      return ''
    }
  }
}

