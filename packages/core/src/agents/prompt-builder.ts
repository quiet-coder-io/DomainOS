/**
 * Builds system prompts for domain-scoped LLM agents.
 * Uses PromptContext input → PromptResult output with manifest for observability.
 */

import { estimateTokens, TOKEN_BUDGETS } from './token-budgets.js'
import type { DomainStatusSnapshot } from '../briefing/domain-status.js'
import { STATUS_CHAR_LIMITS, STATUS_SOFT_CAP_CHARS, STATUS_MAX_SECTION_CHARS } from '../briefing/domain-status-constants.js'

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
  statusBriefing?: DomainStatusSnapshot
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

  // === DOMAIN STATUS BRIEFING === (when status intent detected)
  if (context.statusBriefing) {
    const briefingSection = renderStatusBriefing(context.statusBriefing, context.debug)
    addSection('Domain Status Briefing', briefingSection)
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
confidence: <high|medium|low>
horizon: <immediate|near_term|strategic>
reversibility_class: <reversible|irreversible>
reversibility_notes: <what makes reversal easy or hard>
category: <strategic|tactical|operational>
authority: <source_tier> (<authority_confidence>)
\`\`\`

Quality gates for decisions:
- confidence: how certain you are (high/medium/low)
- horizon: time frame (immediate = days, near_term = weeks, strategic = months+)
- reversibility_class + notes: can this be undone? At what cost?
- category: strategic (direction), tactical (execution), operational (routine)
- authority: cite the KB tier or source (structural/status/intelligence/general/user_statement/tool_result/cross_domain) and your confidence in that source (high/medium/low)

Advisory fence blocks — when producing structured strategic output (brainstorms, risk assessments, scenarios, strategic reviews), use this JSON format:

\`\`\`advisory-<type>
{"schemaVersion":1,"type":"<type>","persist":"no","title":"<4-120 char title>", ...payload fields}
\`\`\`

Types: brainstorm, risk_assessment, scenario, strategic_review.
persist: "no" (default, ephemeral) | "yes" (save to Strategic History) | "archive" (save as archived reference).
Only set persist to "yes" when the user asks to save, or for significant strategic reviews and risk assessments. Casual brainstorming defaults to "no".

Brainstorm payload: topic, options (array of {title, description, pros?, cons?, leverage?, optionality?, risk?, action?}), recommendation, contrarian_view?
Risk assessment payload: summary, risks (array of {category, description, severity?, likelihood?, mitigation?, impact?}), trend? (improving|stable|worsening), trendConfidence? (low|medium|high)
Scenario payload: variables (string array), scenarios (array of {name, description, probability?, outcome?, timeline?}), triggers? (string array), leading_indicators? (string array)
Strategic review payload: posture, highest_leverage_action, trajectory?, tensions? (string array), assumptions_to_check? (string array)`
  addSection('KB Update Instructions', kbInstructions)

  // === ADVISORY MINI-PROTOCOL (always-on) ===
  const advisoryMiniProtocol = `=== ADVISORY PROTOCOL ===
Mode classification: Before each response, classify user intent as one of: brainstorm | challenge | review | scenario | general.
Classification considers conversational context, not just trigger words. Ambiguous defaults to general.
Emit <!-- advisory_mode: <mode> --> as a hidden comment at the start of your response.

Mode formatting:
- brainstorm: 3-5 options with pros/cons and a recommendation
- challenge: weakest link, opposing argument, unstated assumptions, failure modes
- review: posture assessment, trajectory, highest-leverage action
- scenario: key variables, 3 scenarios (best/base/worst), triggers

Cross-domain fact labeling: When citing facts from sibling domains via tools, include "(per [DomainName] KB — cross-domain)" in the same sentence. Never state cross-domain facts without attribution.

Proactive insights: Max 1 per user statement, only at decision points. Format as "**Insight:** [content]" — a single inline paragraph, not a section or heading.
Insight guards:
- When user intent is "draft" (email/doc/memo): no proactive insight unless explicitly requested.
- Insight must not introduce new facts — only interpret/reframe existing facts from KB, tool output, or user statements. If referencing numbers, dates, or proper nouns not in current context, include (assumption) label.`
  addSection('Advisory Mini-Protocol', advisoryMiniProtocol)

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

// ── Status Briefing Rendering ──

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

interface BriefingSection {
  header: string
  totalCount: number
  items: string[]
  required: boolean
}

export function renderStatusBriefing(snapshot: DomainStatusSnapshot, debug?: boolean): string {
  const sections: BriefingSection[] = []

  // Health + KB (always required, combined into one)
  sections.push({
    header: '',
    totalCount: 0,
    items: [
      `[COMPUTED — system-calculated, treat as ground truth]`,
      `Health: Severity ${snapshot.severityScore} | Status: ${snapshot.status}`,
      `KB: ${snapshot.kbStalenessHeadline}`,
    ],
    required: true,
  })

  // Top Actions (required)
  if (snapshot.topActions.length > 0) {
    sections.push({
      header: 'Priority Actions (pre-ranked)',
      totalCount: snapshot.topActions.length,
      items: snapshot.topActions.map((a, i) =>
        `${i + 1}. ${truncate(a.text, STATUS_CHAR_LIMITS.actionText)} — ${truncate(a.rationale, STATUS_CHAR_LIMITS.actionRationale)}`
      ),
      required: true,
    })
  }

  // Overdue Deadlines (required — always show even if 0)
  sections.push({
    header: 'Overdue Deadlines',
    totalCount: snapshot.overdueDeadlines.length,
    items: snapshot.overdueDeadlines.length === 0
      ? ['None']
      : snapshot.overdueDeadlines.map(d =>
          `P${d.priority} · ${d.dueDate} · ${truncate(d.text, STATUS_CHAR_LIMITS.deadlineText)} (${d.daysOverdue}d overdue)`
        ),
    required: true,
  })

  // Upcoming Deadlines (required)
  if (snapshot.upcomingDeadlines.length > 0) {
    sections.push({
      header: 'Upcoming 14 Days',
      totalCount: snapshot.upcomingDeadlines.length,
      items: snapshot.upcomingDeadlines.map(d =>
        `P${d.priority} · ${d.dueDate} · ${truncate(d.text, STATUS_CHAR_LIMITS.deadlineText)} (${d.daysUntilDue}d)`
      ),
      required: true,
    })
  }

  // Open Gap Flags (required)
  if (snapshot.openGapFlags.length > 0) {
    sections.push({
      header: 'Open Gap Flags',
      totalCount: snapshot.openGapFlags.length,
      items: snapshot.openGapFlags.map(g =>
        `${g.category}: ${truncate(g.description, STATUS_CHAR_LIMITS.gapDescription)}`
      ),
      required: true,
    })
  }

  // Recently Resolved (required)
  if (snapshot.recentlyResolvedGapFlags.length > 0) {
    sections.push({
      header: 'Recently Resolved',
      totalCount: snapshot.recentlyResolvedGapFlags.length,
      items: snapshot.recentlyResolvedGapFlags.map(g =>
        `${g.category}: ${truncate(g.description, STATUS_CHAR_LIMITS.gapDescription)} — resolved ${dateOnly(g.resolvedAt)}`
      ),
      required: true,
    })
  }

  // RECORDED label
  sections.push({
    header: '',
    totalCount: 0,
    items: [`\n[RECORDED — from domain event log, P1=highest urgency]`],
    required: true,
  })

  // Decisions (optional)
  if (snapshot.recentDecisions.length > 0) {
    sections.push({
      header: 'Active Decisions',
      totalCount: snapshot.recentDecisions.length,
      items: snapshot.recentDecisions.map(d =>
        `${d.category ?? 'uncat'} · ${truncate(d.decision, STATUS_CHAR_LIMITS.decisionText)} · ${d.confidence ?? 'n/a'}`
      ),
      required: false,
    })
  }

  // Audit events (optional)
  if (snapshot.recentAuditEvents.length > 0) {
    sections.push({
      header: 'Since Last Session',
      totalCount: snapshot.recentAuditEvents.length,
      items: snapshot.recentAuditEvents.map(e =>
        `${e.eventType}: ${truncate(e.description, STATUS_CHAR_LIMITS.auditDescription)} — ${dateOnly(e.createdAt)}`
      ),
      required: false,
    })
  }

  // Artifacts (optional, narrative history)
  if (snapshot.recentArtifacts.length > 0) {
    sections.push({
      header: '',
      totalCount: 0,
      items: [`\n[NARRATIVE HISTORY — prior strategic analysis, may be outdated]`],
      required: false,
    })
    sections.push({
      header: 'Recent Advisory',
      totalCount: snapshot.recentArtifacts.length,
      items: [`If relevant, you MAY reference these:`, ...snapshot.recentArtifacts.map(a =>
        `${a.type}: ${truncate(a.title, STATUS_CHAR_LIMITS.artifactTitle)} — ${dateOnly(a.createdAt)}`
      )],
      required: false,
    })
  }

  // Render with budget
  return renderWithBudget(snapshot, sections, debug)
}

function renderWithBudget(
  snapshot: DomainStatusSnapshot,
  sections: BriefingSection[],
  debug?: boolean,
): string {
  const lines: string[] = [
    `=== DOMAIN STATUS BRIEFING ===`,
    `You MUST treat this as a status briefing request.`,
    snapshot.sinceWindow.label,
    '',
  ]
  let charCount = lines.join('\n').length
  const omittedSections: string[] = []
  let hardCapHit = false
  let softCapHit = false

  for (const section of sections) {
    // Check soft cap for optional sections
    if (!section.required && (softCapHit || charCount >= STATUS_SOFT_CAP_CHARS)) {
      softCapHit = true
      if (section.header) omittedSections.push(section.header)
      continue
    }

    // Build section content
    const sectionLines: string[] = []

    if (section.header) {
      // Headerless sections (health, labels) have no count display
      if (section.totalCount > 0) {
        sectionLines.push(`${section.header} (${section.items.length}${section.items.length < section.totalCount ? ` shown of ${section.totalCount}` : ''}):`)
      } else {
        sectionLines.push(`${section.header}:`)
      }
    }

    // Add items one by one, checking hard cap
    let itemsRendered = 0
    for (const item of section.items) {
      const lineChars = item.length + 1 // +1 for newline
      if (charCount + lineChars > STATUS_MAX_SECTION_CHARS) {
        hardCapHit = true
        break
      }
      sectionLines.push(item)
      charCount += lineChars
      itemsRendered++
    }

    // Update header if we truncated items within this section
    if (section.header && section.totalCount > 0 && itemsRendered < section.items.length) {
      sectionLines[0] = `${section.header} (${itemsRendered} shown of ${section.totalCount}):`
    }

    lines.push(...sectionLines)

    if (hardCapHit) {
      if (section.header) {
        // Section was partially rendered — no need to add to omitted
      }
      break
    }
  }

  // Add response format instructions
  const responseFormat = `
=== BRIEFING RESPONSE FORMAT ===
Structure your response as:
1. **Health** — 1-2 sentence domain health assessment
2. **What Changed** — since last session (from [RECORDED] events above; if no audit events are shown, state "No event log available for this period" instead of inventing changes)
3. **Action Items** — use [COMPUTED] Priority Actions as your checklist; present all of them, do not skip or re-rank
4. **Upcoming** — deadlines in next 14 days
5. **Strategic Context** — relevant decisions or advisory insights

Do not invent missing deadlines/decisions/gaps; if a section has 0 items, say "None."
If Priority Actions is empty, state: "No computed action items found." Then recommend checking deadlines and gap flags via tools.
Do not infer causality from the severity score — report it as a computed metric, not an explanation.
If you call Gmail/GTasks tools, summarize results and link them back to Action Items.

Search hints for tool enrichment:
Gmail: ${snapshot.searchHints.gmailQueries.join(' | ')}
GTasks: ${snapshot.searchHints.gtasksQueries.join(' | ')}`

  // Check if response format fits
  if (charCount + responseFormat.length <= STATUS_MAX_SECTION_CHARS + 600) {
    // Response format is critical — always include even if slightly over hard cap
    lines.push(responseFormat)
  }

  // Footer
  if (omittedSections.length > 0) {
    lines.push(`\n(sections omitted: ${omittedSections.join(', ')})`)
  }
  if (hardCapHit) {
    lines.push('NOTE: Briefing truncated due to size limits; treat missing sections as unknown.')
  }

  const rendered = lines.join('\n')

  if (debug) {
    console.log(`[prompt-builder] StatusBriefingRender: chars=${rendered.length} omitted=[${omittedSections.join(',')}] hardCapHit=${hardCapHit}`)
  }

  return rendered
}
