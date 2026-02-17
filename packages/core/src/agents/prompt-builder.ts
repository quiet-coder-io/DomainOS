/**
 * Builds system prompts for domain-scoped LLM agents.
 */

export interface PromptDomain {
  name: string
  description: string
}

export interface PromptKBContext {
  files: Array<{ path: string; content: string }>
}

export interface PromptProtocol {
  name: string
  content: string
}

export function buildSystemPrompt(
  domain: PromptDomain,
  kbContext: PromptKBContext,
  protocols: PromptProtocol[],
): string {
  const sections: string[] = []

  sections.push(`=== DOMAIN: ${domain.name} ===`)
  sections.push(domain.description)

  sections.push('')
  sections.push('=== KNOWLEDGE BASE ===')
  for (const file of kbContext.files) {
    sections.push(`--- FILE: ${file.path} ---`)
    sections.push(file.content)
  }

  sections.push('')
  sections.push('=== PROTOCOLS ===')
  for (const protocol of protocols) {
    sections.push(`--- ${protocol.name} ---`)
    sections.push(protocol.content)
  }

  sections.push('')
  sections.push('=== KB UPDATE INSTRUCTIONS ===')
  sections.push(`When you need to suggest updates to the knowledge base, use this format:

\`\`\`kb-update
file: <filename>
action: <create|update|delete>
reasoning: <why this change is needed>
---
<new file content>
\`\`\``)

  return sections.join('\n')
}
