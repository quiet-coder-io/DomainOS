/**
 * Encrypted credential storage for Gmail OAuth tokens.
 * Uses Electron's safeStorage API (OS keychain) for encryption.
 * Refuses to store if encryption is unavailable.
 */

import { safeStorage, app } from 'electron'
import { writeFile, readFile, unlink, access } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface GmailCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  email: string
}

const CREDS_FILENAME = 'gmail-creds.enc'

function getCredsPath(): string {
  return resolve(app.getPath('userData'), CREDS_FILENAME)
}

export async function saveGmailCredentials(creds: GmailCredentials): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available. Cannot securely store Gmail credentials.')
  }

  const json = JSON.stringify(creds)
  const encrypted = safeStorage.encryptString(json)
  await writeFile(getCredsPath(), encrypted)
}

export async function loadGmailCredentials(): Promise<GmailCredentials | null> {
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
    return JSON.parse(json) as GmailCredentials
  } catch (e) {
    // Corrupt file — clean up and return null
    console.error('[gmail-credentials] Failed to decrypt, removing corrupt file:', (e as Error).message)
    try {
      await unlink(credsPath)
    } catch {
      // ignore
    }
    return null
  }
}

export async function clearGmailCredentials(): Promise<void> {
  try {
    await unlink(getCredsPath())
  } catch {
    // File didn't exist, that's fine
  }
}

/**
 * Check connection status. Returns structured state for UI rendering.
 */
export async function checkGmailConnected(): Promise<{
  connected: boolean
  blocked: boolean
  email?: string
}> {
  const blocked = !safeStorage.isEncryptionAvailable()
  if (blocked) {
    return { connected: false, blocked: true }
  }

  const creds = await loadGmailCredentials()
  if (!creds) {
    return { connected: false, blocked: false }
  }

  return { connected: true, blocked: false, email: creds.email }
}
