/**
 * Encrypted credential storage for Google Tasks OAuth tokens.
 * Uses Electron's safeStorage API (OS keychain) for encryption.
 * Refuses to store if encryption is unavailable.
 */

import { safeStorage, app } from 'electron'
import { writeFile, readFile, unlink, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { GTasksClient } from '@domain-os/integrations'

export interface GTasksCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  email: string
}

const CREDS_FILENAME = 'gtasks-creds.enc'

function getCredsPath(): string {
  return resolve(app.getPath('userData'), CREDS_FILENAME)
}

export async function saveGTasksCredentials(creds: GTasksCredentials): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available. Cannot securely store Google Tasks credentials.')
  }

  const json = JSON.stringify(creds)
  const encrypted = safeStorage.encryptString(json)
  await writeFile(getCredsPath(), encrypted)
}

export async function loadGTasksCredentials(): Promise<GTasksCredentials | null> {
  const credsPath = getCredsPath()

  try {
    await access(credsPath)
  } catch {
    return null
  }

  try {
    const encrypted = await readFile(credsPath)
    if (!safeStorage.isEncryptionAvailable()) {
      return null
    }
    const json = safeStorage.decryptString(encrypted)
    return JSON.parse(json) as GTasksCredentials
  } catch (e) {
    // Corrupt file — clean up and return null (self-healing)
    console.error('[gtasks-credentials] Failed to decrypt, removing corrupt file:', (e as Error).message)
    try {
      await unlink(credsPath)
    } catch {
      // ignore
    }
    return null
  }
}

export async function clearGTasksCredentials(): Promise<void> {
  try {
    await unlink(getCredsPath())
  } catch {
    // File didn't exist, that's fine
  }
}

/**
 * Check connection status. Returns structured state for UI rendering.
 * Validates token freshness by calling Google API — all failure modes
 * (expired token, network error, revoked access) are treated as `expired`.
 */
export async function checkGTasksConnected(): Promise<{
  connected: boolean
  blocked: boolean
  expired?: boolean
  email?: string
}> {
  const blocked = !safeStorage.isEncryptionAvailable()
  if (blocked) {
    return { connected: false, blocked: true }
  }

  const creds = await loadGTasksCredentials()
  if (!creds) {
    return { connected: false, blocked: false }
  }

  // Validate token freshness
  try {
    const client = new GTasksClient({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
    })
    const profile = await client.getProfile()
    if (!profile.ok) {
      return { connected: false, blocked: false, expired: true, email: creds.email }
    }
  } catch {
    // Bare catch — intentionally no logging to avoid leaking clientId/clientSecret
    return { connected: false, blocked: false, expired: true, email: creds.email }
  }

  return { connected: true, blocked: false, email: creds.email }
}
