/**
 * Loan review prompt builder — constructs system + user prompts
 * for CMBS-methodology loan document review.
 */

export interface LoanReviewContext {
  digest: string
  domainName: string
  docsReviewed: string[]
  docsMissing: string[]
}

const VALID_DEPTHS = ['triage', 'attorney-prep', 'full-review'] as const
export type ReviewDepth = typeof VALID_DEPTHS[number]

export function validateReviewDepth(input: unknown): ReviewDepth {
  const s = typeof input === 'string' ? input.trim().toLowerCase() : ''
  return (VALID_DEPTHS as readonly string[]).includes(s) ? (s as ReviewDepth) : 'attorney-prep'
}

const DEPTH_INSTRUCTIONS: Record<ReviewDepth, string> = {
  triage: `REVIEW DEPTH: TRIAGE
Focus on red-flag identification only. Skip detailed clause analysis.
Produce a brief memo (1-2 paragraphs per section) highlighting only critical issues.
Heatmap should contain only critical/high-risk items.`,
  'attorney-prep': `REVIEW DEPTH: ATTORNEY-PREP
Standard review depth. Analyze key loan terms, covenants, and compliance items.
Produce a comprehensive memo covering all 5 sections with actionable findings.
Heatmap should include all identified risk items at every severity level.`,
  'full-review': `REVIEW DEPTH: FULL-REVIEW
Exhaustive analysis. Cover every clause, exhibit, and schedule.
Produce a detailed memo with specific page/section references where possible.
Heatmap should be comprehensive with granular risk scoring and all escalation items.`,
}

/**
 * Build system + user prompts for loan document review.
 */
export function buildLoanReviewPrompt(
  context: LoanReviewContext,
  inputs: Record<string, unknown>,
): { system: string; user: string } {
  const depth = validateReviewDepth(inputs.reviewDepth)

  const docInventory = buildDocInventory(context.docsReviewed, context.docsMissing)
  const system = buildSystemPrompt(context, depth, docInventory)
  const user = `Review the loan documents. Apply ${depth} mode. Produce the memo block and heatmap JSON block as instructed.`

  return { system, user }
}

function buildDocInventory(reviewed: string[], missing: string[]): string {
  const lines: string[] = ['<doc_inventory>']

  if (reviewed.length > 0) {
    lines.push('DOCUMENTS REVIEWED:')
    for (const doc of reviewed) {
      lines.push(`  - ${doc}`)
    }
  } else {
    lines.push('DOCUMENTS REVIEWED: (full KB digest loaded)')
  }

  if (missing.length > 0) {
    lines.push('')
    lines.push('DOCUMENTS NOT FOUND (requested but missing):')
    for (const doc of missing) {
      lines.push(`  - ${doc}`)
    }
  }

  lines.push('</doc_inventory>')
  return lines.join('\n')
}

function buildSystemPrompt(
  context: LoanReviewContext,
  depth: ReviewDepth,
  docInventory: string,
): string {
  return `You are a CMBS loan document review specialist operating within the DomainOS system.

IDENTITY & MANDATE:
You review commercial real estate loan documents for ${context.domainName} using established CMBS underwriting methodology. Your analysis must be thorough, objective, and attorney-ready. You identify risks, compliance gaps, and areas requiring immediate attention.

RISK SCORING METHODOLOGY:
- CRITICAL (score 9-10): Immediate legal/financial exposure. Requires stop-work or immediate escalation.
- HIGH (score 7-8): Material risk that could affect loan performance or compliance. Requires near-term action.
- MEDIUM (score 4-6): Notable item requiring monitoring or future attention.
- LOW (score 1-3): Minor observation, informational.

WORKFLOW:
1. Inventory all provided documents against standard CMBS loan doc checklist
2. Analyze each document for key terms, covenants, compliance requirements
3. Cross-reference terms across documents for consistency
4. Identify missing documents and their materiality
5. Score risk items using the methodology above
6. Produce structured output in the exact format specified

CMBS COMPLIANCE CHECKS:
- Debt service coverage ratio (DSCR) requirements and triggers
- Loan-to-value (LTV) covenant compliance
- Reserve/escrow requirements and adequacy
- Insurance coverage requirements and expiration tracking
- Environmental compliance (Phase I/II status)
- Title and survey issues
- Guarantor/sponsor financial covenant compliance
- Reporting requirements and deadline compliance
- Transfer/assumption restrictions
- Prepayment provisions and yield maintenance
- Default triggers and cure periods
- Cash management / lockbox provisions

${DEPTH_INSTRUCTIONS[depth]}

${docInventory}

<kb_context>
${context.digest || '(No KB content available)'}
</kb_context>

OUTPUT FORMAT — STRICT REQUIREMENTS:

You MUST produce exactly TWO fenced output blocks. No other JSON blocks. No other fenced blocks.

Block 1: A markdown memo in a \`\`\`loan_review_memo fence with exactly 5 sections:

\`\`\`loan_review_memo
## 1. Executive Summary
[Brief overview of the loan, key terms, and overall risk assessment]

## 2. Document Inventory & Gaps
[List of documents reviewed, documents missing, materiality of gaps]

## 3. Key Terms & Covenant Analysis
[DSCR, LTV, reserves, insurance, reporting requirements, compliance status]

## 4. Risk Assessment & Findings
[Detailed findings organized by severity: critical → high → medium → low]

## 5. Recommendations & Next Steps
[Actionable recommendations, escalation items, follow-up timeline]
\`\`\`

Block 2: A structured JSON heatmap in a \`\`\`loan_review_heatmap_json fence:

\`\`\`loan_review_heatmap_json
{
  "riskItems": [
    {
      "category": "string (e.g., 'DSCR Covenant', 'Insurance', 'Environmental')",
      "description": "string",
      "severity": "critical | high | medium | low",
      "score": number (1-10),
      "action": "string (recommended action)",
      "deadline": "string (ISO date or 'immediate' or 'monitor')"
    }
  ],
  "stopReview": false,
  "stopReason": "string (only if stopReview is true)",
  "missingDocs": ["string"],
  "escalations": [
    {
      "item": "string",
      "urgency": "immediate | near-term | scheduled",
      "assignTo": "string (e.g., 'attorney', 'asset manager', 'insurance broker')"
    }
  ]
}
\`\`\`

Do NOT include any other fenced code blocks in your response.`
}
