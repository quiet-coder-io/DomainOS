/**
 * Builds system prompts for domain-scoped LLM agents.
 * Uses PromptContext input → PromptResult output with manifest for observability.
 */

import { estimateTokens, TOKEN_BUDGETS } from './token-budgets.js'

// --- Input types ---

export interface PromptDomain {
  name: string
  description: string
  identity?: string
  escalationTriggers?: string
}

export interface PromptKBFile {
  path: string
  content: string
  tier?: string
  stalenessLabel?: string
}

export interface PromptKBContext {
  files: PromptKBFile[]
}

export interface PromptProtocol {
  name: string
  content: string
}

export interface PromptSiblingContext {
  siblings: Array<{
    domainName: string
    digestContent: string
  }>
}

export interface PromptSessionContext {
  scope: string
  startupReport: string
}

export interface PromptContext {
  domain: PromptDomain
  kbContext: PromptKBContext
  protocols: PromptProtocol[]
  sharedProtocols?: PromptProtocol[]
  siblingContext?: PromptSiblingContext
  sessionContext?: PromptSessionContext
  currentDate?: string
  debug?: boolean
}

// --- Output types ---

export interface PromptManifestSection {
  name: string
  tokenEstimate: number
}

export interface PromptManifestFile {
  path: string
  tier: string
  chars: number
  tokenEstimate: number
  inclusionReason: 'tier-priority' | 'within-budget' | 'required'
}

export interface PromptManifestExcludedFile {
  path: string
  reason: string
}

export interface PromptManifest {
  sections: PromptManifestSection[]
  filesIncluded: PromptManifestFile[]
  filesExcluded: PromptManifestExcludedFile[]
  totalTokenEstimate: number
}

export interface PromptResult {
  prompt: string
  manifest: PromptManifest
}

// --- Builder ---

export function buildSystemPrompt(context: PromptContext): PromptResult {
  const sections: string[] = []
  const manifestSections: PromptManifestSection[] = []
  const filesIncluded: PromptManifestFile[] = []
  const filesExcluded: PromptManifestExcludedFile[] = []

  function addSection(name: string, content: string): void {
    sections.push(content)
    manifestSections.push({ name, tokenEstimate: estimateTokens(content.length) })
  }

  // === CURRENT DATE ===
  if (context.currentDate) {
    addSection('Current Date', `=== CURRENT DATE ===\n${context.currentDate}`)
  }

  // === AGENT IDENTITY ===
  if (context.domain.identity) {
    const identitySection = `=== AGENT IDENTITY ===\n${context.domain.identity}`
    addSection('Agent Identity', identitySection)
  }

  // === DOMAIN ===
  const domainSection = `=== DOMAIN: ${context.domain.name} ===\n${context.domain.description}`
  addSection('Domain', domainSection)

  // === KNOWLEDGE BASE ===
  const kbLines: string[] = ['=== KNOWLEDGE BASE ===']
  for (const file of context.kbContext.files) {
    const tierLabel = file.tier ? `[${file.tier.toUpperCase()}] ` : ''
    const stalenessLabel = file.stalenessLabel ? `${file.stalenessLabel} ` : ''
    const header = `--- ${tierLabel}${stalenessLabel}${file.path} ---`
    kbLines.push(header)
    kbLines.push(file.content)

    filesIncluded.push({
      path: file.path,
      tier: file.tier ?? 'general',
      chars: file.content.length,
      tokenEstimate: estimateTokens(file.content.length),
      inclusionReason: 'within-budget',
    })
  }
  addSection('Knowledge Base', kbLines.join('\n'))

  // === SIBLING DOMAINS === (Phase 2)
  if (context.siblingContext && context.siblingContext.siblings.length > 0) {
    const siblingLines: string[] = [
      '=== SIBLING DOMAINS ===',
      'CROSS-DOMAIN CONTAMINATION GUARD: Dates, deadlines, and dollar amounts from sibling domains require explicit source verification before use.',
      '',
    ]
    for (const sibling of context.siblingContext.siblings) {
      siblingLines.push(`--- ${sibling.domainName} ---`)
      siblingLines.push(sibling.digestContent)
    }
    addSection('Sibling Domains', siblingLines.join('\n'))
  }

  // === SHARED PROTOCOLS ===
  if (context.sharedProtocols && context.sharedProtocols.length > 0) {
    const protoLines: string[] = ['=== SHARED PROTOCOLS ===']
    for (const proto of context.sharedProtocols) {
      protoLines.push(`--- ${proto.name} ---`)
      protoLines.push(proto.content)
    }
    addSection('Shared Protocols', protoLines.join('\n'))
  }

  // === DOMAIN PROTOCOLS ===
  const domainProtoLines: string[] = ['=== DOMAIN PROTOCOLS ===']
  for (const protocol of context.protocols) {
    domainProtoLines.push(`--- ${protocol.name} ---`)
    domainProtoLines.push(protocol.content)
  }
  addSection('Domain Protocols', domainProtoLines.join('\n'))

  // === ESCALATION TRIGGERS ===
  if (context.domain.escalationTriggers) {
    const escSection = `=== ESCALATION TRIGGERS ===\n${context.domain.escalationTriggers}`
    addSection('Escalation Triggers', escSection)
  }

  // === SESSION === (Phase 3)
  if (context.sessionContext) {
    const sessionLines = [
      '=== SESSION ===',
      `Scope: ${context.sessionContext.scope}`,
      '',
      context.sessionContext.startupReport,
    ]
    addSection('Session', sessionLines.join('\n'))
  }

  // === KB UPDATE INSTRUCTIONS ===
  const kbInstructions = `=== KB UPDATE INSTRUCTIONS ===
When you need to suggest updates to the knowledge base, use this format:

\`\`\`kb-update
file: <filename>
action: <create|update|delete>
tier: <structural|status|intelligence|general>
mode: <full|append|patch>
basis: <primary|sibling|external|user>
reasoning: <why this change is needed>
confirm: DELETE <filename>
---
<new file content>
\`\`\`

Tier write rules:
- structural (claude.md): mode must be "patch" — never full replace
- status (kb_digest.md): mode "full" or "append" allowed
- intelligence (kb_intel.md): any mode allowed
- general: any mode allowed
- Deletes: include "confirm: DELETE <filename>" or the delete will be rejected

Decision blocks — when you make a significant decision, record it:

\`\`\`decision
decision_id: <short-kebab-case-id>
decision: <what was decided>
rationale: <why this was chosen>
downside: <known tradeoffs>
revisit_trigger: <when to reconsider>
linked_files: <comma-separated KB files affected>
\`\`\``
  addSection('KB Update Instructions', kbInstructions)

  const prompt = sections.join('\n\n')
  const totalTokenEstimate = estimateTokens(prompt.length)

  return {
    prompt,
    manifest: {
      sections: manifestSections,
      filesIncluded,
      filesExcluded,
      totalTokenEstimate,
    },
  }
}
