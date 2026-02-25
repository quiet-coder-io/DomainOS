/**
 * Provider-agnostic LLM ↔ tool execution loop.
 *
 * Key correctness invariants:
 * - Uses normalized ToolCapableProvider interface (works with Anthropic, OpenAI, Ollama)
 * - Tool results are appended in provider-returned toolCalls order (never sorted)
 * - Every tool call gets a corresponding tool result (even on error/skip)
 * - System prompt is set once and reused unchanged across rounds
 * - rawAssistantMessage is source of truth for round-tripping (never reconstructed)
 *
 * Tool rounds use non-streaming completions (D6). Normal (no tools) path uses streaming.
 * Do NOT "optimize" tool rounds to use streaming — breaks round-tripping.
 *
 * Gmail ROWYS (read-only-what-you-searched) guard is provider-agnostic (D8).
 */

import type {
  ToolCapableProvider,
  ToolDefinition,
  ToolUseMessage,
  ChatMessage,
  ChatOptions,
} from '@domain-os/core'
import {
  ToolsNotSupportedError,
  maybeWrapToolsNotSupported,
  toolCapKey,
  setToolCapability,
  notObservedCounters,
} from '@domain-os/core'
import type { GmailClient, GTasksClient } from '@domain-os/integrations'
import type Database from 'better-sqlite3'
import type { WebContents } from 'electron'
import { executeGmailTool } from './gmail-tools'
import { executeGTasksTool } from './gtasks-tools'
import { executeAdvisoryTool } from './advisory-tools'
import { executeBrainstormTool } from './brainstorm-tools'

// ── Constants (D12) ──

const MAX_TOOL_RESULT_BYTES = 75_000
const MAX_TRANSCRIPT_BYTES = 400_000
const MAX_TOOL_CALLS_PER_ROUND = 5

// ── Secret-stripping patterns (D18) ──

const SECRET_PATTERNS = [
  /Authorization:\s*Bearer\s+\S+/gi,
  /Set-Cookie:\s*[^\n]+/gi,
  /X-API-Key:\s*\S+/gi,
  /api_key=\S+/gi,
  /x-goog-api-key:\s*\S+/gi,
  /refresh_token['":\s]*\S+/gi,
  /-----BEGIN[^\n]*-----[\s\S]*?-----END[^\n]*-----/g,
]

/** Base64 blobs >200 chars (likely binary data or tokens). */
const LONG_BASE64_PATTERN = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{200,}={0,3}/g

export interface ToolUseEvent {
  toolName: string
  toolUseId: string
  status: 'running' | 'done'
  domainId: string
  roundIndex: number
  detail?: {
    query?: string
    resultCount?: number
    messageId?: string
    subject?: string
    taskId?: string
    taskListTitle?: string
  }
}

export interface ToolLoopOptions {
  provider: ToolCapableProvider
  providerName: string
  model: string
  domainId: string
  userMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  systemPrompt: string
  tools: ToolDefinition[]
  db?: Database.Database
  gmailClient?: GmailClient
  gtasksClient?: GTasksClient
  eventSender: WebContents
  maxRounds?: number
  ollamaBaseUrl?: string
  signal?: AbortSignal
}

export interface ToolLoopResult {
  fullResponse: string
  toolCalls: Array<{ toolUseId: string; name: string; input: unknown }>
  cancelled?: boolean
}

/**
 * Read-only-what-you-searched guard (D8).
 * Maintains sets of message/thread IDs returned by gmail_search.
 * gmail_read calls are validated against these sets.
 * Provider-agnostic — lives here, not in GmailClient or provider adapters.
 */
interface AccessGuard {
  allowedMessageIds: Set<string>
  allowedThreadIds: Set<string>
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const {
    provider,
    providerName,
    model,
    domainId,
    userMessages,
    systemPrompt,
    tools,
    db: toolDb,
    gmailClient,
    gtasksClient,
    eventSender,
    maxRounds = 5,
    ollamaBaseUrl,
    signal,
  } = options

  const capKey = toolCapKey(providerName, model, ollamaBaseUrl)

  // Deep-clone tool schemas before passing to adapter (D19)
  const toolsForProvider: ToolDefinition[] = tools.map((t) => ({
    ...t,
    inputSchema: structuredClone(t.inputSchema),
  }))

  const messages: ToolUseMessage[] = userMessages.map((m) => {
    if (m.role === 'assistant') {
      // Historical assistant messages from conversation history don't have rawMessage.
      // Synthesize provider-appropriate rawMessage for round-tripping.
      return {
        role: 'assistant' as const,
        rawMessage: synthesizeHistoricalRawMessage(providerName, m.content),
        derivedText: m.content,
      }
    }
    return { role: 'user' as const, content: m.content }
  })

  const allToolCalls: Array<{ toolUseId: string; name: string; input: unknown }> = []
  const guard: AccessGuard = {
    allowedMessageIds: new Set(),
    allowedThreadIds: new Set(),
  }

  let consecutiveMaxTokens = 0

  try {
    for (let round = 1; round <= maxRounds + 1; round++) {
      // Abort checkpoint 1: top of each round
      if (signal?.aborted) {
        return { fullResponse: getLastAssistantText(messages), toolCalls: allToolCalls, cancelled: true }
      }

      // D15: structured logging
      console.info(`[tool-loop] round_start provider=${providerName} model=${model} round=${round} domainId=${domainId}`)

      if (round > maxRounds) {
        // Max rounds exceeded — final chatComplete with system suffix (D12/D15)
        console.info(`[tool-loop] tool_fallback reason=max_rounds provider=${providerName} model=${model} rounds=${round}`)
        const systemWithNotice = systemPrompt + '\n\n[Tool loop reached max rounds. Respond with best available info using tool results already obtained.]'
        const finalResult = await provider.chatComplete(flattenForChatComplete(messages), systemWithNotice)
        const finalText = finalResult.ok ? finalResult.value : 'I encountered an error generating a final response.'
        pseudoStream(eventSender, finalText)
        return { fullResponse: finalText, toolCalls: allToolCalls }
      }

      // D13: validate transcript before sending
      validateTranscript(messages)

      const startMs = Date.now()
      const response = await provider.createToolUseMessage(
        {
          messages,
          systemPrompt,
          tools: toolsForProvider,
        },
        { signal },
      )
      const latencyMs = Date.now() - startMs

      // Abort checkpoint 2: after createToolUseMessage
      if (signal?.aborted) {
        return { fullResponse: response.textContent || getLastAssistantText(messages), toolCalls: allToolCalls, cancelled: true }
      }

      console.info(`[tool-loop] round_end stopReason=${response.stopReason} toolCallsCount=${response.toolCalls.length} latencyMs=${latencyMs}`)

      // Append assistant message (rawMessage is source of truth, derivedText for UI)
      messages.push({
        role: 'assistant',
        rawMessage: response.rawAssistantMessage,
        derivedText: response.textContent,
      })

      // Update capability cache on successful tool use (D14)
      if (response.stopReason === 'tool_use' && response.toolCalls.length > 0) {
        // Will be promoted to 'supported' after tool execution succeeds (below)
        notObservedCounters.set(capKey, 0)
      }

      // Edge case: tool_use signal but 0 calls → treat as end_turn, log warning
      if (response.stopReason === 'tool_use' && response.toolCalls.length === 0) {
        console.warn('[tool-loop] tool_use signal with 0 tool calls — treating as end_turn')
        pseudoStream(eventSender, response.textContent)
        return { fullResponse: response.textContent, toolCalls: allToolCalls }
      }

      // Consecutive max_tokens breaker (D13b)
      if (response.stopReason === 'max_tokens') {
        consecutiveMaxTokens++
      } else {
        consecutiveMaxTokens = 0
      }
      if (consecutiveMaxTokens >= 2) {
        console.warn('[tool-loop] consecutive max_tokens, exiting tool loop')
        pseudoStream(eventSender, response.textContent)
        return { fullResponse: response.textContent, toolCalls: allToolCalls }
      }

      // D13b: max_tokens with no tool calls → exit and continue via chatComplete
      if (response.stopReason === 'max_tokens' && response.toolCalls.length === 0) {
        const contSystem = systemPrompt + '\n\n[Continue using prior context; response may have been cut off.]'
        const contResult = await provider.chatComplete(flattenForChatComplete(messages), contSystem)
        const contText = contResult.ok ? contResult.value : response.textContent
        pseudoStream(eventSender, contText)
        return { fullResponse: contText, toolCalls: allToolCalls }
      }

      // Normal end_turn with no tool calls → done
      if (response.stopReason !== 'tool_use' && response.toolCalls.length === 0) {
        // Track not_observed for capability cache (D14)
        const counter = (notObservedCounters.get(capKey) ?? 0) + 1
        notObservedCounters.set(capKey, counter)
        if (counter >= 2) {
          setToolCapability(providerName, model, 'not_observed', ollamaBaseUrl)
          console.info(`[tool-loop] capability_cache_update key=${capKey} status=not_observed`)
        }

        pseudoStream(eventSender, response.textContent)
        return { fullResponse: response.textContent, toolCalls: allToolCalls }
      }

      // Execute tools in provider-returned order, cap at MAX_TOOL_CALLS_PER_ROUND
      const callsToExecute = response.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND)
      const skippedCalls = response.toolCalls.slice(MAX_TOOL_CALLS_PER_ROUND)

      let toolExecutionSucceeded = false

      for (const call of callsToExecute) {
        // Abort checkpoint 3: before each tool execution
        if (signal?.aborted) {
          return { fullResponse: response.textContent || getLastAssistantText(messages), toolCalls: allToolCalls, cancelled: true }
        }

        const input = call.input
        allToolCalls.push({ toolUseId: call.id, name: call.name, input })

        // Send "running" IPC event
        const runningDetail: ToolUseEvent['detail'] = {}
        if (call.name === 'gmail_search') {
          runningDetail.query = typeof input.query === 'string' ? input.query : undefined
        } else if (call.name === 'gmail_read') {
          runningDetail.messageId = typeof input.message_id === 'string' ? input.message_id : undefined
        } else if (call.name === 'gtasks_search') {
          runningDetail.taskListTitle = typeof input.list_name === 'string' ? input.list_name : undefined
        } else if (call.name === 'gtasks_read' || call.name === 'gtasks_complete' || call.name === 'gtasks_update' || call.name === 'gtasks_delete') {
          runningDetail.taskId = typeof input.task_id === 'string' ? input.task_id : undefined
        }

        const runningEvent: ToolUseEvent = {
          toolName: call.name,
          toolUseId: call.id,
          status: 'running',
          domainId,
          roundIndex: round - 1,
          detail: runningDetail,
        }
        eventSender.send('chat:tool-use', runningEvent)

        const toolStart = Date.now()
        let result: string
        const errorPrefix = call.name.startsWith('advisory_') ? 'ADVISORY_ERROR' : call.name.startsWith('brainstorm_') ? 'BRAINSTORM_ERROR' : call.name.startsWith('gtasks_') ? 'GTASKS_ERROR' : 'GMAIL_ERROR'

        try {
          if (call.name.startsWith('gmail_') && gmailClient) {
            // ROWYS guard for gmail_read (D8, provider-agnostic)
            if (call.name === 'gmail_read') {
              const msgId = typeof input.message_id === 'string' ? input.message_id : ''
              if (!guard.allowedMessageIds.has(msgId)) {
                result = 'GMAIL_ERROR: access — Message ID not found in recent search results. Run gmail_search first.'
              } else {
                result = await executeGmailTool(gmailClient, call.name, input)
              }
            } else {
              result = await executeGmailTool(gmailClient, call.name, input)
            }

            // Populate ROWYS guard from search results
            if (call.name === 'gmail_search' && !result.startsWith('GMAIL_ERROR:')) {
              const jsonMatch = result.match(/--- JSON START ---\n([\s\S]*?)\n--- JSON END ---/)
              if (jsonMatch) {
                try {
                  const parsed = JSON.parse(jsonMatch[1]) as Array<{ messageId: string; threadId: string }>
                  for (const item of parsed) {
                    guard.allowedMessageIds.add(item.messageId)
                    guard.allowedThreadIds.add(item.threadId)
                  }
                } catch {
                  // JSON parse fail — guard stays restrictive
                }
              }
            }
          } else if (call.name.startsWith('gtasks_') && gtasksClient) {
            result = await executeGTasksTool(gtasksClient, call.name, input)
          } else if (call.name.startsWith('advisory_') && toolDb) {
            result = executeAdvisoryTool(toolDb, call.name, input)
          } else if (call.name.startsWith('brainstorm_') && toolDb) {
            result = executeBrainstormTool(toolDb, call.name, input, domainId)
          } else {
            result = `${errorPrefix}: executor — No client available for tool ${call.name}`
          }

          toolExecutionSucceeded = true
        } catch (e) {
          result = `${errorPrefix}: executor — ${e instanceof Error ? e.message : String(e)}`
        }

        // D18: sanitize tool output (strip secrets/auth headers)
        result = sanitizeToolOutput(call.name, result)

        // D12: truncate oversized results (byte-based)
        if (Buffer.byteLength(result, 'utf8') > MAX_TOOL_RESULT_BYTES) {
          result = truncateToByteLimit(result, MAX_TOOL_RESULT_BYTES) + '\n[truncated at 75KB]'
        }

        const toolLatency = Date.now() - toolStart
        const isError = result.startsWith('GMAIL_ERROR:') || result.startsWith('GTASKS_ERROR:') || result.startsWith('ADVISORY_ERROR:') || result.startsWith('BRAINSTORM_ERROR:')
        console.info(`[tool-loop] tool_execution toolName=${call.name} toolCallId=${call.id} success=${!isError} latencyMs=${toolLatency}`)

        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: result,
        })

        // Send "done" IPC event with richer detail
        const doneDetail: ToolUseEvent['detail'] = {}
        if (call.name === 'gmail_search') {
          const countMatch = result.match(/GMAIL_SEARCH_RESULTS \(n=(\d+)\)/)
          doneDetail.resultCount = countMatch ? parseInt(countMatch[1], 10) : 0
        } else if (call.name === 'gmail_read') {
          const subjectMatch = result.match(/^Subject: (.+)$/m)
          doneDetail.subject = subjectMatch ? subjectMatch[1] : '(no subject)'
        } else if (call.name === 'gtasks_search') {
          const countMatch = result.match(/GTASKS_SEARCH_RESULTS \(n=(\d+)\)/)
          doneDetail.resultCount = countMatch ? parseInt(countMatch[1], 10) : 0
        } else if (call.name === 'gtasks_read' || call.name === 'gtasks_complete' || call.name === 'gtasks_update') {
          const titleMatch = result.match(/^Title: (.+)$/m)
          doneDetail.taskListTitle = titleMatch ? titleMatch[1] : '(no title)'
        } else if (call.name === 'gtasks_delete') {
          doneDetail.taskListTitle = '(deleted)'
        }

        const doneEvent: ToolUseEvent = {
          toolName: call.name,
          toolUseId: call.id,
          status: 'done',
          domainId,
          roundIndex: round - 1,
          detail: doneDetail,
        }
        eventSender.send('chat:tool-use', doneEvent)

        // Abort checkpoint 4: after each tool execution
        if (signal?.aborted) {
          return { fullResponse: response.textContent || getLastAssistantText(messages), toolCalls: allToolCalls, cancelled: true }
        }
      }

      // Skipped calls get proper tool results (keeps transcript invariants)
      for (const call of skippedCalls) {
        allToolCalls.push({ toolUseId: call.id, name: call.name, input: call.input })
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: '[Skipped: per-round tool call limit reached]',
        })
      }

      // D14: promote to 'supported' after successful tool execution
      if (toolExecutionSucceeded && response.stopReason === 'tool_use') {
        setToolCapability(providerName, model, 'supported', ollamaBaseUrl)
      }

      // D12: check total transcript size (byte-based)
      if (estimateTranscriptBytes(messages) > MAX_TRANSCRIPT_BYTES) {
        console.warn('[tool-loop] transcript size exceeded 400KB, exiting tool loop')
        const overflowSystem = systemPrompt + '\n\n[Tool context exceeded size limit. Respond with best available info.]'
        const overflowResult = await provider.chatComplete(flattenForChatComplete(messages), overflowSystem)
        const overflowText = overflowResult.ok ? overflowResult.value : 'Tool context grew too large. Please try a more specific query.'
        pseudoStream(eventSender, overflowText)
        return { fullResponse: overflowText, toolCalls: allToolCalls }
      }
    }

    // Should not reach here — loop exits via returns above
    return { fullResponse: '', toolCalls: allToolCalls }
  } catch (e) {
    // D10/D16: catch ToolsNotSupportedError → fallback to chatComplete
    const toolErr = e instanceof ToolsNotSupportedError ? e : maybeWrapToolsNotSupported(e)
    if (toolErr) {
      console.info(`[tool-loop] tool_fallback reason=tools_not_supported provider=${providerName} model=${model}`)
      setToolCapability(providerName, model, 'not_supported', ollamaBaseUrl)
      const fallbackResult = await provider.chatComplete(flattenForChatComplete(messages), systemPrompt)
      const fallbackText = fallbackResult.ok ? fallbackResult.value : 'The model does not support tool use. Please try a different model.'
      pseudoStream(eventSender, fallbackText)
      return { fullResponse: fallbackText, toolCalls: allToolCalls }
    }
    throw e
  }
}

// ── Helpers ──

/**
 * D13: Validate transcript before passing to createToolUseMessage().
 * Fail fast with clear error on invalid entries.
 */
function validateTranscript(messages: ToolUseMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      if (msg.rawMessage === undefined || msg.rawMessage === null) {
        throw new Error(`Invalid transcript state at index ${i}: assistant message missing rawMessage`)
      }
    } else if (msg.role === 'tool') {
      if (!msg.toolCallId) {
        throw new Error(`Invalid transcript state at index ${i}: tool message missing toolCallId`)
      }
      if (!msg.toolName) {
        throw new Error(`Invalid transcript state at index ${i}: tool message missing toolName`)
      }
      if (typeof msg.content !== 'string') {
        throw new Error(`Invalid transcript state at index ${i}: tool message content must be string`)
      }
    }
  }
}

/**
 * D11: Convert ToolUseMessage[] → ChatMessage[] for chatComplete() fallback.
 * Deterministic: never merges adjacent messages. One user message per tool result.
 */
export function flattenForChatComplete(messages: ToolUseMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      result.push({ role: 'assistant', content: msg.derivedText ?? '' })
    } else if (msg.role === 'tool') {
      result.push({ role: 'user', content: `[Tool result (${msg.toolName}): ${msg.content}]` })
    }
  }
  return result
}

/**
 * D18: Sanitize tool output — strip secrets/auth headers.
 * Gmail tools get stricter sanitization; other tools get minimal.
 */
function sanitizeToolOutput(toolName: string, output: string): string {
  let sanitized = output
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  }
  // Strip long base64 blobs (likely tokens or binary data)
  sanitized = sanitized.replace(LONG_BASE64_PATTERN, '[REDACTED]')
  return sanitized
}

/**
 * D12: Truncate string to byte limit without breaking UTF-8.
 * Finds last clean line break before the limit.
 */
function truncateToByteLimit(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, 'utf8')
  if (buf.length <= maxBytes) return str

  // Find a clean line break before the limit
  let cutoff = maxBytes
  while (cutoff > 0 && buf[cutoff] !== 0x0a) {
    cutoff--
  }
  // If no line break found, just cut at the byte limit
  if (cutoff === 0) cutoff = maxBytes

  // Decode the truncated buffer — Buffer.toString handles partial codepoints safely
  return buf.subarray(0, cutoff).toString('utf8')
}

/** Estimate total transcript size in bytes. */
function estimateTranscriptBytes(messages: ToolUseMessage[]): number {
  let total = 0
  for (const msg of messages) {
    if (msg.role === 'user') {
      total += Buffer.byteLength(msg.content, 'utf8')
    } else if (msg.role === 'assistant') {
      total += Buffer.byteLength(msg.derivedText ?? '', 'utf8')
    } else if (msg.role === 'tool') {
      total += Buffer.byteLength(msg.content, 'utf8')
    }
  }
  return total
}

/**
 * Synthesize a rawMessage for historical assistant messages (from conversation history).
 * These messages pre-date the tool loop and only have text content.
 * The rawMessage format must match what each provider's converter expects:
 * - Anthropic: array of ContentBlock objects
 * - OpenAI/Ollama: ChatCompletionMessage-like object
 */
function synthesizeHistoricalRawMessage(providerName: string, content: string): unknown {
  if (providerName === 'anthropic') {
    return [{ type: 'text', text: content }]
  }
  // OpenAI / Ollama
  return { role: 'assistant', content }
}

/** Extract the last assistant derivedText from the transcript (for cancelled returns). */
function getLastAssistantText(messages: ToolUseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return (messages[i] as { derivedText?: string }).derivedText ?? ''
    }
  }
  return ''
}

/** Pseudo-stream text on paragraph boundaries for streaming UX. */
function pseudoStream(eventSender: WebContents, text: string): void {
  const paragraphs = text.split('\n\n')
  for (let i = 0; i < paragraphs.length; i++) {
    const chunk = i < paragraphs.length - 1 ? paragraphs[i] + '\n\n' : paragraphs[i]
    eventSender.send('chat:stream-chunk', chunk)
  }
  eventSender.send('chat:stream-done')
}
