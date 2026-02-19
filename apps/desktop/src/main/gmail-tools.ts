/**
 * Gmail tool definitions, input validation, and executor for LLM tool-use.
 *
 * Defines the two tools (gmail_search, gmail_read) and validates/executes
 * them against the GmailClient. All errors are returned as strings (never thrown)
 * to ensure tool_result blocks are always emitted.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { GmailClient } from '@domain-os/integrations'

/** Maximum size for any tool result string (prevents context blowup). */
const MAX_RESULT_SIZE = 12_000

export const GMAIL_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'gmail_search',
    description:
      'Search Gmail messages. Returns subject, sender, date, snippet, and message ID for each result.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Gmail search query (supports Gmail syntax: from:, subject:, after:, is:unread, etc.)',
        },
        max_results: {
          type: 'number',
          description: 'Max results 1-20, default 10',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description:
      'Read the full content of a Gmail message by ID (from gmail_search results).',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: {
          type: 'string',
          description: 'Gmail message ID from search results',
        },
      },
      required: ['message_id'],
    },
  },
]

/**
 * Execute a Gmail tool call. Always returns a string (never throws).
 * Errors are prefixed with "GMAIL_ERROR:" for stable detection.
 */
export async function executeGmailTool(
  client: GmailClient,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    let result: string

    if (name === 'gmail_search') {
      result = await executeSearch(client, input)
    } else if (name === 'gmail_read') {
      result = await executeRead(client, input)
    } else {
      result = `Unknown tool: ${name}`
    }

    // Final size guard
    if (result.length > MAX_RESULT_SIZE) {
      result = result.slice(0, MAX_RESULT_SIZE) + '\n[result truncated]'
    }

    return result
  } catch (e) {
    return formatGmailError(e)
  }
}

async function executeSearch(
  client: GmailClient,
  input: Record<string, unknown>,
): Promise<string> {
  const query = input.query
  if (typeof query !== 'string' || !query.trim()) {
    return 'GMAIL_ERROR: validation — query must be a non-empty string.'
  }
  if (query.length > 500) {
    return 'GMAIL_ERROR: validation — query must be 500 characters or less.'
  }

  let maxResults = 10
  if (input.max_results != null) {
    const n = Number(input.max_results)
    if (!isNaN(n)) {
      maxResults = Math.min(20, Math.max(1, Math.round(n)))
    }
  }

  const results = await client.search(query.trim(), maxResults)

  if (results.length === 0) {
    return 'GMAIL_SEARCH_RESULTS (n=0)\nNo messages found matching this query.'
  }

  const lines = results.map(
    (r) =>
      `- messageId: ${r.messageId} | threadId: ${r.threadId} | from: ${r.from} | subject: ${r.subject} | date: ${r.date}`,
  )

  const json = JSON.stringify(
    results.map((r) => ({
      messageId: r.messageId,
      threadId: r.threadId,
      from: r.from,
      subject: r.subject,
      date: r.date,
    })),
  )

  return [
    `GMAIL_SEARCH_RESULTS (n=${results.length})`,
    ...lines,
    '--- JSON START ---',
    json,
    '--- JSON END ---',
  ].join('\n')
}

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]+$/

async function executeRead(
  client: GmailClient,
  input: Record<string, unknown>,
): Promise<string> {
  const messageId = input.message_id
  if (typeof messageId !== 'string' || !messageId.trim()) {
    return 'GMAIL_ERROR: validation — message_id must be a non-empty string.'
  }
  if (messageId.length < 10 || messageId.length > 200) {
    return 'GMAIL_ERROR: validation — message_id must be 10-200 characters.'
  }
  if (!MESSAGE_ID_PATTERN.test(messageId)) {
    return 'GMAIL_ERROR: validation — message_id contains invalid characters.'
  }

  const msg = await client.read(messageId)
  if (!msg) {
    return 'GMAIL_ERROR: not_found — Message not found or inaccessible.'
  }

  const body = msg.body || 'No text/plain body found. The email may contain only HTML content.'

  return [
    'GMAIL_MESSAGE',
    `From: ${msg.from}`,
    `To: ${msg.to.join(', ')}`,
    `Subject: ${msg.subject}`,
    `Date: ${msg.date}`,
    `Thread: ${msg.threadId}`,
    '--- BODY ---',
    body,
    '--- END ---',
  ].join('\n')
}

function formatGmailError(e: unknown): string {
  if (!(e instanceof Error)) return `GMAIL_ERROR: unknown — ${String(e)}`

  const msg = e.message
  const anyErr = e as { code?: number; errors?: Array<{ reason?: string }> }
  const code = anyErr.code
  const reason = anyErr.errors?.[0]?.reason ?? ''

  if (code === 429 || (code === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'))) {
    return 'GMAIL_ERROR: rate_limited — Try again in a minute.'
  }

  if (code === 403 && (reason === 'insufficientPermissions' || reason === 'forbidden')) {
    return 'GMAIL_ERROR: insufficient_permissions — Reconnect and approve Gmail access.'
  }

  if (code === 403) {
    return 'GMAIL_ERROR: forbidden — Permission denied or Gmail API disabled.'
  }

  if (code === 401 || msg.includes('invalid_grant')) {
    return 'GMAIL_ERROR: invalid_grant — Token expired or revoked. Please reconnect Gmail.'
  }

  return `GMAIL_ERROR: api — ${msg}`
}
