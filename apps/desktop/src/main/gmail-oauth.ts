/**
 * Gmail OAuth PKCE flow via system browser + loopback server.
 *
 * Uses Auth Code flow with PKCE (no client secret). Opens the system
 * default browser for Google's consent screen, then catches the redirect
 * on a temporary loopback HTTP server.
 */

import { shell } from 'electron'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { google } from 'googleapis'
import { saveGmailCredentials, clearGmailCredentials, loadGmailCredentials } from './gmail-credentials'

// Desktop/Native app OAuth from GCP project DomainOS
// Google requires client_secret even for Desktop apps (it's not truly secret for installed apps)
// Loaded from .env: MAIN_VITE_GMAIL_CLIENT_ID, MAIN_VITE_GMAIL_CLIENT_SECRET
const CLIENT_ID = import.meta.env.MAIN_VITE_GMAIL_CLIENT_ID ?? ''
const CLIENT_SECRET = import.meta.env.MAIN_VITE_GMAIL_CLIENT_SECRET ?? ''
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
]
const CALLBACK_PATH = '/oauth2callback'
const AUTH_TIMEOUT_MS = 120_000

/** Module-level lock to prevent concurrent OAuth flows. */
let oauthInFlight: Promise<{ clientId: string; refreshToken: string; email: string }> | null = null

export async function startGmailOAuth(): Promise<{ clientId: string; refreshToken: string; email: string }> {
  if (oauthInFlight) return oauthInFlight

  oauthInFlight = doOAuth().finally(() => {
    oauthInFlight = null
  })

  return oauthInFlight
}

async function doOAuth(): Promise<{ clientId: string; refreshToken: string; email: string }> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Gmail OAuth credentials not configured. Add MAIN_VITE_GMAIL_CLIENT_ID and MAIN_VITE_GMAIL_CLIENT_SECRET to apps/desktop/.env')
  }

  // Generate PKCE code verifier + challenge
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

  // CSRF state parameter
  const state = randomBytes(16).toString('hex')

  // Optionally pre-select account if we have a prior email
  const existingCreds = await loadGmailCredentials()
  const loginHint = existingCreds?.email

  return new Promise((resolve, reject) => {
    let resolved = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    const server = createServer(async (req, res) => {
      // Only handle exact callback path
      const url = new URL(req.url ?? '', `http://127.0.0.1`)
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Not the callback path.</p></body></html>')
        return
      }

      // Single-consume: ignore duplicate hits (favicon, retries)
      if (resolved) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Already processed. You can close this tab.</p></body></html>')
        return
      }
      resolved = true

      // Verify CSRF state
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Invalid state parameter. Authorization denied.</p></body></html>')
        cleanup()
        reject(new Error('OAuth state mismatch'))
        return
      }

      // Check for error
      const error = url.searchParams.get('error')
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Authorization was denied. You can close this tab.</p></body></html>')
        cleanup()
        reject(new Error(`OAuth error: ${error}`))
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>No authorization code received.</p></body></html>')
        cleanup()
        reject(new Error('No authorization code in callback'))
        return
      }

      try {
        // Exchange code for tokens
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        })

        const tokenData = (await tokenRes.json()) as {
          refresh_token?: string
          access_token?: string
          error?: string
          error_description?: string
        }

        if (tokenData.error || !tokenData.refresh_token) {
          const detail = tokenData.error_description || tokenData.error || 'No refresh_token returned'
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`<html><body><p>Authorization failed: ${detail}. You can close this tab.</p></body></html>`)
          cleanup()
          reject(new Error(
            tokenData.refresh_token
              ? detail
              : 'No refresh_token returned by Google. Try Disconnect → Connect again, or remove DomainOS from Google Account permissions and retry.',
          ))
          return
        }

        // Get profile email
        const auth = new google.auth.OAuth2(CLIENT_ID)
        auth.setCredentials({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
        })
        const gmail = google.gmail({ version: 'v1', auth })
        let email = ''
        try {
          const profile = await gmail.users.getProfile({ userId: 'me' })
          email = profile.data.emailAddress ?? ''
        } catch {
          // Non-fatal: we still have valid tokens
        }

        // Store credentials
        await saveGmailCredentials({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          refreshToken: tokenData.refresh_token,
          email,
        })

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Gmail connected successfully! You can close this tab.</p></body></html>')
        cleanup()
        resolve({ clientId: CLIENT_ID, refreshToken: tokenData.refresh_token, email })
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Token exchange failed. You can close this tab.</p></body></html>')
        cleanup()
        reject(e)
      }
    })

    function cleanup(): void {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      try { server.close() } catch { /* ignore */ }
    }

    // Bind to loopback only (not 0.0.0.0)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', SCOPES.join(' '))
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('include_granted_scopes', 'true')
      if (loginHint) authUrl.searchParams.set('login_hint', loginHint)

      shell.openExternal(authUrl.toString())
    })

    // Timeout after 120s
    timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        reject(new Error('OAuth timed out after 120 seconds'))
      }
    }, AUTH_TIMEOUT_MS)
  })
}

/**
 * Disconnect: clear local credentials, then best-effort revoke token.
 */
export async function disconnectGmail(): Promise<void> {
  const creds = await loadGmailCredentials()
  // Clear local first (ensures creds never remain on disk even if revoke fails)
  await clearGmailCredentials()

  if (creds?.refreshToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(creds.refreshToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    } catch {
      // Best-effort revocation — ignore failures
    }
  }
}
