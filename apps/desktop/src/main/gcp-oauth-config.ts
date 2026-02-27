/**
 * Encrypted storage for GCP OAuth client credentials.
 * Users enter their own Client ID + Secret in Settings;
 * stored via Electron safeStorage (OS keychain).
 */

import { safeStorage, app } from 'electron'
import { writeFile, readFile, unlink, access } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface GCPOAuthConfig {
  clientId: string
  clientSecret: string
}

const CONFIG_FILENAME = 'gcp-oauth-config.enc'

function getConfigPath(): string {
  return resolve(app.getPath('userData'), CONFIG_FILENAME)
}

export async function saveGCPOAuthConfig(config: GCPOAuthConfig): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available. Cannot securely store OAuth credentials.')
  }

  const json = JSON.stringify(config)
  const encrypted = safeStorage.encryptString(json)
  await writeFile(getConfigPath(), encrypted)
}

export async function loadGCPOAuthConfig(): Promise<GCPOAuthConfig | null> {
  const configPath = getConfigPath()

  try {
    await access(configPath)
  } catch {
    return null
  }

  try {
    const encrypted = await readFile(configPath)
    if (!safeStorage.isEncryptionAvailable()) {
      return null
    }
    const json = safeStorage.decryptString(encrypted)
    return JSON.parse(json) as GCPOAuthConfig
  } catch (e) {
    console.error('[gcp-oauth-config] Failed to decrypt, removing corrupt file:', (e as Error).message)
    try {
      await unlink(configPath)
    } catch {
      // ignore
    }
    return null
  }
}

export async function clearGCPOAuthConfig(): Promise<void> {
  try {
    await unlink(getConfigPath())
  } catch {
    // File didn't exist, that's fine
  }
}
