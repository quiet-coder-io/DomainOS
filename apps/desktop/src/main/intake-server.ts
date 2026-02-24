import { createServer } from 'node:http'
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import { IntakeRepository, MAX_INTAKE_CONTENT_BYTES } from '@domain-os/core'
import type { IntakeItem } from '@domain-os/core'
import { validateIntakeToken } from './intake-token'
import { emitAutomationEvent } from './automation-events'

const PORT = 19532
const HOST = '127.0.0.1'
const MAX_BODY_BYTES = MAX_INTAKE_CONTENT_BYTES + 1024

let server: Server | null = null

// Rate limiter — per-IP, sliding window
const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  let timestamps = rateLimitMap.get(ip)
  if (!timestamps) {
    timestamps = []
    rateLimitMap.set(ip, timestamps)
  }
  while (timestamps.length > 0 && timestamps[0] < now - RATE_WINDOW_MS) {
    timestamps.shift()
  }
  if (timestamps.length === 0) {
    rateLimitMap.delete(ip)
    return false
  }
  if (timestamps.length >= RATE_LIMIT) return true
  timestamps.push(now)
  return false
}

function setCORSHeaders(res: ServerResponse): void {
  // No Access-Control-Allow-Origin — browser same-origin policy blocks web pages.
  // Chrome extensions bypass CORS via host_permissions in manifest.json.
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function sendJSON(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let bytes = 0

    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      body += chunk.toString()
    })

    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

export function startIntakeServer(
  db: Database.Database,
  onNewItem: (item: IntakeItem) => void,
): void {
  const repo = new IntakeRepository(db)

  server = createServer(async (req, res) => {
    setCORSHeaders(res)

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)

    // GET /api/ping — health check (no auth, no rate limit)
    if (req.method === 'GET' && url.pathname === '/api/ping') {
      sendJSON(res, 200, { ok: true })
      return
    }

    // Rate limit all endpoints except /api/ping
    const clientIP = req.socket.remoteAddress ?? '127.0.0.1'
    if (isRateLimited(clientIP)) {
      sendJSON(res, 429, { error: 'Too many requests' })
      return
    }

    // GET /api/intake/check — dedup check for external sources
    if (req.method === 'GET' && url.pathname === '/api/intake/check') {
      const token = extractBearerToken(req)
      if (!token || !validateIntakeToken(token)) {
        sendJSON(res, 401, { error: 'Invalid or missing auth token' })
        return
      }

      const sourceType = url.searchParams.get('sourceType') ?? ''
      const externalId = url.searchParams.get('externalId') ?? ''

      if (!sourceType || !externalId) {
        sendJSON(res, 400, { error: 'sourceType and externalId required' })
        return
      }

      const found = repo.findByExternalId(
        sourceType as 'web' | 'gmail' | 'gtasks' | 'manual',
        externalId,
      )
      sendJSON(res, 200, { exists: found.ok && found.value !== null })
      return
    }

    // POST /api/intake — create intake item
    if (req.method === 'POST' && url.pathname === '/api/intake') {
      const token = extractBearerToken(req)
      if (!token || !validateIntakeToken(token)) {
        sendJSON(res, 401, { error: 'Invalid or missing auth token' })
        return
      }

      const contentType = req.headers['content-type'] ?? ''
      if (!contentType.includes('application/json')) {
        sendJSON(res, 415, { error: 'Content-Type must be application/json' })
        return
      }

      try {
        const body = await readBody(req)
        const parsed = JSON.parse(body)

        const result = repo.create({
          sourceUrl: parsed.sourceUrl ?? parsed.source_url ?? '',
          title: parsed.title ?? '',
          content: parsed.content ?? '',
          extractionMode: parsed.extractionMode ?? parsed.extraction_mode ?? 'full',
          sourceType: parsed.sourceType ?? parsed.source_type ?? 'web',
          externalId: parsed.externalId ?? parsed.external_id ?? '',
          metadata: parsed.metadata ?? {},
        })

        if (!result.ok) {
          sendJSON(res, 400, { error: result.error.message })
          return
        }

        onNewItem(result.value)
        emitAutomationEvent({
          type: 'intake_created',
          domainId: result.value.suggestedDomainId ?? '',
          data: { entityId: result.value.id, entityType: 'intake_item', summary: result.value.title },
        })
        sendJSON(res, 201, { ok: true, id: result.value.id })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message === 'Request body too large') {
          sendJSON(res, 413, { error: 'Request body too large' })
        } else {
          sendJSON(res, 400, { error: `Invalid request: ${message}` })
        }
      }
      return
    }

    // 404 for everything else
    sendJSON(res, 404, { error: 'Not found' })
  })

  server.headersTimeout = 10_000
  server.requestTimeout = 30_000

  tryListen(1)
}

function tryListen(attempt: number): void {
  if (!server) return

  server.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[intake-server] Port ${PORT} is in use (attempt ${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        setTimeout(() => tryListen(attempt + 1), RETRY_DELAY_MS)
      } else {
        console.error(`[intake-server] Failed to bind after ${MAX_RETRIES} attempts. Intake server disabled.`)
        server = null
      }
    } else {
      console.error(`[intake-server] Server error: ${err.message}`)
      server = null
    }
  })

  server.listen(PORT, HOST, () => {
    console.log(`Intake server listening on http://${HOST}:${PORT}`)
  })
}

export function stopIntakeServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
