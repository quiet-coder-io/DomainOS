/**
 * LLM provider interface and shared types for agent communication.
 */

import type { Result } from '../common/index.js'
import type { DomainOSError } from '../common/index.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMProvider {
  name: string
  chat(messages: ChatMessage[], systemPrompt: string): AsyncIterable<string>
  chatComplete(messages: ChatMessage[], systemPrompt: string): Promise<Result<string, DomainOSError>>
}
