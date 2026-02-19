/**
 * Anthropic (Claude) implementation of the LLM provider interface.
 * Implements ToolCapableProvider for tool-use loop support.
 */

import Anthropic from '@anthropic-ai/sdk'
import { Ok, Err } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { Result } from '../common/index.js'
import type { ChatMessage, LLMProvider, ToolCapableProvider, ToolUseMessage, ToolUseResponse, ToolDefinition, ToolCall } from './provider.js'

export interface AnthropicProviderOptions {
  apiKey: string
  model?: string
  maxTokens?: number
}

export class AnthropicProvider implements ToolCapableProvider {
  readonly name = 'anthropic'
  readonly supportsTools = true as const
  private readonly client: Anthropic
  private readonly model: string
  private readonly maxTokens: number

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey })
    this.model = options.model ?? 'claude-sonnet-4-20250514'
    this.maxTokens = options.maxTokens ?? 4096
  }

  async *chat(messages: ChatMessage[], systemPrompt: string): AsyncIterable<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }

  /**
   * Non-streaming tool-use message creation using normalized types.
   *
   * Uses stream: false intentionally — tool rounds need full response objects,
   * not streamed deltas. Do NOT "optimize" this to use streaming. (D6)
   */
  async createToolUseMessage(params: {
    messages: ToolUseMessage[]
    systemPrompt: string
    tools: ToolDefinition[]
  }): Promise<ToolUseResponse> {
    // Convert ToolDefinition[] → Anthropic.Messages.Tool[]
    // Key rename only: inputSchema → input_schema. No schema mutation. (D5)
    const anthropicTools: Anthropic.Messages.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
    }))

    // Convert ToolUseMessage[] → Anthropic.Messages.MessageParam[]
    const anthropicMessages = convertToAnthropicMessages(params.messages)

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: params.systemPrompt,
      messages: anthropicMessages,
      ...(anthropicTools.length ? { tools: anthropicTools } : {}),
    })

    // Map stop_reason to normalized stopReason (D9/D17)
    let stopReason: ToolUseResponse['stopReason']
    if (response.stop_reason === 'tool_use') stopReason = 'tool_use'
    else if (response.stop_reason === 'max_tokens') stopReason = 'max_tokens'
    else stopReason = 'end_turn'

    // Extract text content: concatenate type:"text" blocks
    const textContent = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    // Extract tool calls from type:"tool_use" blocks
    const toolCalls: ToolCall[] = response.content
      .filter((block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      }))

    return {
      stopReason,
      textContent,
      toolCalls,
      // rawAssistantMessage = full native content array (preserves text + tool_use blocks)
      rawAssistantMessage: response.content,
    }
  }

  async chatComplete(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<Result<string, DomainOSError>> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      })

      const textBlock = response.content.find((block) => block.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        return Err(DomainOSError.llm('No text content in response'))
      }

      return Ok(textBlock.text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Err(DomainOSError.llm(message))
    }
  }
}

/**
 * Convert ToolUseMessage[] → Anthropic.Messages.MessageParam[].
 *
 * Key rules:
 * - role:'assistant' → pass rawMessage as native content blocks with tool_use
 * - role:'tool' → batch consecutive tool messages into ONE user message with tool_result blocks
 *   (Anthropic requires all tool results for a turn in a single user message)
 * - role:'user' → standard user message
 */
function convertToAnthropicMessages(messages: ToolUseMessage[]): Anthropic.Messages.MessageParam[] {
  const result: Anthropic.Messages.MessageParam[] = []

  let i = 0
  while (i < messages.length) {
    const msg = messages[i]

    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
      i++
    } else if (msg.role === 'assistant') {
      // rawMessage is the native Anthropic content blocks array
      result.push({
        role: 'assistant',
        content: msg.rawMessage as Anthropic.Messages.ContentBlock[],
      })
      i++
    } else if (msg.role === 'tool') {
      // Batch consecutive tool messages into one user message with tool_result blocks
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
      while (i < messages.length && messages[i].role === 'tool') {
        const toolMsg = messages[i] as { role: 'tool'; toolCallId: string; toolName: string; content: string }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolMsg.toolCallId,
          content: toolMsg.content,
        })
        i++
      }
      result.push({ role: 'user', content: toolResults })
    } else {
      i++
    }
  }

  return result
}
