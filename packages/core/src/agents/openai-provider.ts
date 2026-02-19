/**
 * OpenAI implementation of the LLM provider interface.
 * Implements ToolCapableProvider for tool-use loop support.
 *
 * Also serves as base class for OllamaProvider (OpenAI-compatible API).
 */

import OpenAI from 'openai'
import { Ok, Err } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { Result } from '../common/index.js'
import type {
  ChatMessage,
  ToolCapableProvider,
  ToolUseMessage,
  ToolUseResponse,
  ToolDefinition,
  ToolCall,
} from './provider.js'
import { ToolsNotSupportedError, maybeWrapToolsNotSupported } from './provider.js'

export interface OpenAIProviderOptions {
  apiKey: string
  model?: string
  maxTokens?: number
  baseUrl?: string
}

export class OpenAIProvider implements ToolCapableProvider {
  readonly name: string = 'openai'
  readonly supportsTools = true as const
  protected readonly client: OpenAI
  protected readonly model: string
  protected readonly maxTokens: number

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    })
    this.model = options.model ?? 'gpt-4o'
    this.maxTokens = options.maxTokens ?? 4096
  }

  /**
   * Streaming chat for normal (no tools) path.
   * Only concatenates delta.content — ignores delta.tool_calls and other fields.
   * Tool rounds use non-streaming via createToolUseMessage(). (D6)
   */
  async *chat(messages: ChatMessage[], systemPrompt: string): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
    })

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      // Only emit text content — ignore tool_calls, function_call, refusal, etc.
      if (delta?.content) {
        yield delta.content
      }
    }
  }

  async chatComplete(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<Result<string, DomainOSError>> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
      })

      const content = response.choices?.[0]?.message?.content
      if (!content) {
        return Err(DomainOSError.llm('No text content in response'))
      }

      return Ok(content)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Err(DomainOSError.llm(message))
    }
  }

  /**
   * Non-streaming tool-use message creation.
   * Uses stream: false intentionally — tool rounds need full response objects. (D6)
   *
   * OpenAI message round-tripping is strict (D2):
   * - Assistant messages with tool_calls must preserve the full message object
   * - Each tool result maps to one { role: 'tool', tool_call_id, content } message
   */
  async createToolUseMessage(params: {
    messages: ToolUseMessage[]
    systemPrompt: string
    tools: ToolDefinition[]
  }): Promise<ToolUseResponse> {
    // Convert ToolDefinition[] → OpenAI function tools
    // Key rename only: inputSchema → parameters. No schema mutation. (D5)
    const openaiTools: OpenAI.ChatCompletionTool[] = params.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as OpenAI.FunctionParameters,
      },
    }))

    // Convert ToolUseMessage[] → OpenAI ChatCompletionMessageParam[]
    const openaiMessages = convertToOpenAIMessages(params.messages, params.systemPrompt)

    let response: OpenAI.ChatCompletion
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        stream: false, // Explicit: tool rounds are never streamed (D6)
        messages: openaiMessages,
        ...(openaiTools.length ? { tools: openaiTools } : {}),
      })
    } catch (err) {
      // Check if error indicates tools not supported (D10)
      const wrapped = maybeWrapToolsNotSupported(err)
      if (wrapped) throw wrapped
      throw err
    }

    const choice = response.choices?.[0]
    if (!choice) {
      throw new Error('No choice in OpenAI response')
    }

    const message = choice.message

    // Map finish_reason to normalized stopReason (D9/D17)
    let stopReason: ToolUseResponse['stopReason']
    if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use'
    else if (choice.finish_reason === 'length') stopReason = 'max_tokens'
    else stopReason = 'end_turn' // 'stop' and everything else

    // Extract tool calls
    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => {
      // D16: Validate tool call structure (Ollama can return malformed entries)
      if (!tc.id || !tc.function?.name) {
        throw new ToolsNotSupportedError(
          `Malformed tool_call: missing ${!tc.id ? 'id' : 'function.name'}`,
        )
      }

      let input: Record<string, unknown>
      try {
        input = JSON.parse(tc.function.arguments || '{}')
      } catch {
        input = {}
      }

      return {
        id: tc.id,
        name: tc.function.name,
        input,
      }
    })

    return {
      stopReason,
      textContent: message.content ?? '',
      toolCalls,
      // rawAssistantMessage = full native message object (preserves tool_calls for round-tripping)
      rawAssistantMessage: message,
    }
  }
}

/**
 * Convert ToolUseMessage[] → OpenAI ChatCompletionMessageParam[].
 *
 * Key rules (D2):
 * - role:'assistant' → pass rawMessage as native OpenAI message (preserves tool_calls array)
 * - role:'tool' → { role: 'tool', tool_call_id, content } (one per tool result)
 * - role:'user' → { role: 'user', content }
 */
function convertToOpenAIMessages(
  messages: ToolUseMessage[],
  systemPrompt: string,
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ]

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      // rawMessage is the native OpenAI ChatCompletionMessage (includes tool_calls)
      result.push(msg.rawMessage as OpenAI.ChatCompletionMessage)
    } else if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: msg.content,
      })
    }
  }

  return result
}
