/**
 * Gmail-specific types for the integration poller.
 */

export interface GmailPollerConfig {
  /** OAuth2 credentials */
  clientId: string
  clientSecret: string
  refreshToken: string
  /** Intake endpoint config */
  intakeUrl: string
  intakeToken: string
  /** Poll interval in ms (default: 60000) */
  pollIntervalMs?: number
  /** Gmail query filter (default: 'is:unread newer_than:1d') */
  query?: string
  /** Max messages per poll (default: 20) */
  maxResults?: number
}

export interface GmailMessageMeta {
  messageId: string
  threadId: string
  from: string
  to: string[]
  subject: string
  date: string
  labels: string[]
  snippet: string
}
