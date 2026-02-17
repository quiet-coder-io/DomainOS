/**
 * Anthropic (Claude) implementation of the LLM provider interface.
 */

import Anthropic from '@anthropic-ai/sdk'
import { Ok, Err } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { Result } from '../common/index.js'
import type { ChatMessage, LLMProvider } from './provider.js'

export interface AnthropicProviderOptions {
  apiKey: string
  model?: string
  maxTokens?: number
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'
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
