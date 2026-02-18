/**
 * HTTP client for posting items to the DomainOS intake endpoint.
 * Communicates with the Electron main process localhost listener.
 */

import type { IntakePayload, IntakeResponse } from './types.js'

export class IntakeClient {
  constructor(
    private baseUrl: string,
    private authToken: string,
  ) {}

  async post(payload: IntakePayload): Promise<IntakeResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/intake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const text = await res.text()
        return { ok: false, error: `HTTP ${res.status}: ${text}` }
      }

      const body = (await res.json()) as { id?: string }
      return { ok: true, itemId: body.id }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async checkDuplicate(sourceType: string, externalId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/intake/check?sourceType=${encodeURIComponent(sourceType)}&externalId=${encodeURIComponent(externalId)}`,
        {
          headers: { Authorization: `Bearer ${this.authToken}` },
        },
      )
      if (!res.ok) return false
      const body = (await res.json()) as { exists: boolean }
      return body.exists
    } catch {
      return false
    }
  }
}
