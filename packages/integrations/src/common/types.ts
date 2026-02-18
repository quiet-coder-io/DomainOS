/**
 * Shared types for integration modules.
 */

export interface IntakePayload {
  title: string
  content: string
  sourceUrl?: string
  extractionMode?: 'full' | 'excerpt'
  sourceType: 'gmail' | 'gtasks'
  externalId: string
  metadata: Record<string, unknown>
}

export interface IntakeResponse {
  ok: boolean
  itemId?: string
  error?: string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface PollerConfig {
  /** Intake endpoint URL (default: http://localhost:<port>/intake) */
  intakeUrl: string
  /** Auth token for the intake endpoint */
  intakeToken: string
  /** Poll interval in milliseconds (default: 60000 = 1 minute) */
  pollIntervalMs?: number
}
