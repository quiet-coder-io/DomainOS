import { describe, it, expect } from 'vitest'
import { classifyContent } from '../../src/intake/index.js'
import type { LLMProvider, ChatMessage } from '../../src/agents/provider.js'
import { Ok } from '../../src/common/index.js'
import type { Result } from '../../src/common/index.js'
import type { DomainOSError } from '../../src/common/index.js'

function createMockProvider(response: string): LLMProvider {
  return {
    name: 'mock',
    async *chat(): AsyncIterable<string> {
      yield response
    },
    async chatComplete(
      _messages: ChatMessage[],
      _systemPrompt: string,
    ): Promise<Result<string, DomainOSError>> {
      return Ok(response)
    },
  }
}

const testDomains = [
  { id: 'dom-1', name: 'Real Estate', description: 'Property management and investments' },
  { id: 'dom-2', name: 'Engineering', description: 'Software development projects' },
]

describe('classifyContent', () => {
  it('classifies content to a domain', async () => {
    const provider = createMockProvider(
      JSON.stringify({
        domainId: 'dom-1',
        domainName: 'Real Estate',
        confidence: 0.92,
        reasoning: 'Content discusses property management topics',
      }),
    )

    const result = await classifyContent(provider, testDomains, 'Lease Renewal', 'Tenant lease expires next month')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.domainId).toBe('dom-1')
      expect(result.value.confidence).toBe(0.92)
      expect(result.value.reasoning).toBeDefined()
    }
  })

  it('handles markdown-wrapped JSON response', async () => {
    const provider = createMockProvider(
      '```json\n{"domainId":"dom-2","domainName":"Engineering","confidence":0.75,"reasoning":"Code-related"}\n```',
    )

    const result = await classifyContent(provider, testDomains, 'PR Review', 'Fix null pointer bug')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.domainId).toBe('dom-2')
    }
  })

  it('returns error for no domains', async () => {
    const provider = createMockProvider('{}')

    const result = await classifyContent(provider, [], 'Test', 'Content')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('returns parse error for invalid JSON', async () => {
    const provider = createMockProvider('not valid json at all')

    const result = await classifyContent(provider, testDomains, 'Test', 'Content')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('PARSE_ERROR')
    }
  })

  it('returns parse error for missing required fields', async () => {
    const provider = createMockProvider(JSON.stringify({ domainId: 'dom-1' }))

    const result = await classifyContent(provider, testDomains, 'Test', 'Content')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('PARSE_ERROR')
    }
  })
})
