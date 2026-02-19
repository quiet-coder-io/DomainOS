/**
 * Orchestrates LLM ↔ tool execution loop with proper Anthropic content block semantics.
 *
 * Key correctness invariants:
 * - Assistant messages preserve ALL content blocks (text + tool_use) untransformed
 * - tool_result blocks go in a user-role message, each referencing tool_use_id
 * - Every tool_use block gets a corresponding tool_result (even on error)
 * - tool_result order matches tool_use block order
 * - System prompt is set once and reused unchanged across rounds
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { AnthropicProvider } from '@domain-os/core'
import type { GmailClient } from '@domain-os/integrations'
import type { WebContents } from 'electron'
import { executeGmailTool } from './gmail-tools'

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
  }
}

export interface ToolLoopOptions {
  provider: AnthropicProvider
  domainId: string
  userMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  systemPrompt: string
  tools: Anthropic.Messages.Tool[]
  gmailClient: GmailClient
  eventSender: WebContents
  maxRounds?: number
}

export interface ToolLoopResult {
  fullResponse: string
  toolCalls: Array<{ toolUseId: string; name: string; input: unknown }>
}

/**
 * Read-only-what-you-searched guard.
 * Maintains sets of message/thread IDs returned by gmail_search.
 * gmail_read calls are validated against these sets.
 */
interface AccessGuard {
  allowedMessageIds: Set<string>
  allowedThreadIds: Set<string>
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const {
    provider,
    domainId,
    userMessages,
    systemPrompt,
    tools,
    gmailClient,
    eventSender,
    maxRounds = 5,
  } = options

  const messages: Anthropic.Messages.MessageParam[] = userMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  const allToolCalls: Array<{ toolUseId: string; name: string; input: unknown }> = []
  const guard: AccessGuard = {
    allowedMessageIds: new Set(),
    allowedThreadIds: new Set(),
  }

  let response = await provider.createMessage({
    messages,
    system: systemPrompt,
    tools,
  })

  let round = 0

  while (response.stop_reason === 'tool_use' && round < maxRounds) {
    // Append the full assistant message with all content blocks untransformed
    messages.push({ role: 'assistant', content: response.content })

    // Collect tool_use blocks (preserve order)
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
    )

    // Execute each tool and build result map
    const resultMap: Record<string, string> = {}

    for (const block of toolUseBlocks) {
      const input = block.input as Record<string, unknown>

      allToolCalls.push({ toolUseId: block.id, name: block.name, input })

      // Send "running" IPC event
      const runningEvent: ToolUseEvent = {
        toolName: block.name,
        toolUseId: block.id,
        status: 'running',
        domainId,
        roundIndex: round,
        detail: block.name === 'gmail_search'
          ? { query: typeof input.query === 'string' ? input.query : undefined }
          : { messageId: typeof input.message_id === 'string' ? input.message_id : undefined },
      }
      eventSender.send('chat:tool-use', runningEvent)

      let result: string
      try {
        // Read-only-what-you-searched guard for gmail_read
        if (block.name === 'gmail_read') {
          const msgId = typeof input.message_id === 'string' ? input.message_id : ''
          if (!guard.allowedMessageIds.has(msgId)) {
            result = 'GMAIL_ERROR: access — Message ID not found in recent search results. Run gmail_search first.'
          } else {
            result = await executeGmailTool(gmailClient, block.name, input)
          }
        } else {
          result = await executeGmailTool(gmailClient, block.name, input)
        }

        // If this was a search, populate the access guard
        if (block.name === 'gmail_search' && !result.startsWith('GMAIL_ERROR:')) {
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
      } catch (e) {
        result = `GMAIL_ERROR: executor — ${e instanceof Error ? e.message : String(e)}`
      }

      resultMap[block.id] = result

      // Send "done" IPC event with richer detail
      const doneDetail: ToolUseEvent['detail'] = {}
      if (block.name === 'gmail_search') {
        const countMatch = result.match(/GMAIL_SEARCH_RESULTS \(n=(\d+)\)/)
        doneDetail.resultCount = countMatch ? parseInt(countMatch[1], 10) : 0
      } else if (block.name === 'gmail_read') {
        const subjectMatch = result.match(/^Subject: (.+)$/m)
        doneDetail.subject = subjectMatch ? subjectMatch[1] : '(no subject)'
      }

      const doneEvent: ToolUseEvent = {
        toolName: block.name,
        toolUseId: block.id,
        status: 'done',
        domainId,
        roundIndex: round,
        detail: doneDetail,
      }
      eventSender.send('chat:tool-use', doneEvent)
    }

    // Append tool results as a user message (order matches tool_use blocks)
    messages.push({
      role: 'user',
      content: toolUseBlocks.map((block) => ({
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: resultMap[block.id],
      })),
    })

    // Next round
    response = await provider.createMessage({
      messages,
      system: systemPrompt,
      tools,
    })

    round++
  }

  // Extract final text from the last response's text blocks
  let fullResponse = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

  // If we hit maxRounds, append notice
  if (round >= maxRounds && response.stop_reason === 'tool_use') {
    fullResponse += '\n\n[Tool loop stopped after ' + maxRounds + ' rounds. Responding with best available information.]'
  }

  // Pseudo-stream on paragraph boundaries for streaming UX
  const paragraphs = fullResponse.split('\n\n')
  for (let i = 0; i < paragraphs.length; i++) {
    const chunk = i < paragraphs.length - 1 ? paragraphs[i] + '\n\n' : paragraphs[i]
    eventSender.send('chat:stream-chunk', chunk)
    if (i < paragraphs.length - 1) {
      await sleep(30)
    }
  }
  eventSender.send('chat:stream-done')

  return { fullResponse, toolCalls: allToolCalls }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
