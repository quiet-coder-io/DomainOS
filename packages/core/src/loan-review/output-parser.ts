/**
 * Loan review output parser — deterministic fence extraction
 * for loan_review_memo and loan_review_heatmap_json blocks.
 */

import type { MissionParseResult } from '../missions/output-parser.js'

// ── Heatmap types ──

export interface LoanReviewRiskItem {
  category: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  score: number
  action: string
  deadline: string
}

export interface LoanReviewEscalation {
  item: string
  urgency: 'immediate' | 'near-term' | 'scheduled'
  assignTo: string
}

export interface LoanReviewHeatmap {
  riskItems: LoanReviewRiskItem[]
  stopReview: boolean
  stopReason?: string
  missingDocs: string[]
  escalations: LoanReviewEscalation[]
}

// ── Fence regex patterns (case-sensitive, non-greedy) ──

const MEMO_FENCE_RE = /```loan_review_memo\s*\n([\s\S]*?)```/g
const HEATMAP_FENCE_RE = /```loan_review_heatmap_json\s*\n([\s\S]*?)```/g

/**
 * Parse raw LLM text into structured loan review outputs.
 *
 * Enforces single-occurrence of each fence. Multiple occurrences
 * produce a diagnostic warning and use only the first match.
 */
export function parseLoanReview(rawText: string): MissionParseResult {
  const diagnostics: { skippedBlocks: number; errors: string[] } = {
    skippedBlocks: 0,
    errors: [],
  }

  // ── Extract memo fence ──
  const memoMatches = [...rawText.matchAll(MEMO_FENCE_RE)]
  let fullText = ''
  const hasMemoFence = memoMatches.length > 0

  if (memoMatches.length > 1) {
    diagnostics.errors.push(`Multiple loan_review_memo fences found (${memoMatches.length}); using first`)
    diagnostics.skippedBlocks += memoMatches.length - 1
  }

  if (hasMemoFence) {
    fullText = memoMatches[0][1].trim()
  } else {
    // Fallback: use raw text with diagnostic
    diagnostics.errors.push('No loan_review_memo fence found; falling back to raw text')
    fullText = rawText.trim()
  }

  // ── Extract heatmap fence ──
  const heatmapMatches = [...rawText.matchAll(HEATMAP_FENCE_RE)]
  let heatmap: LoanReviewHeatmap | undefined
  const hasHeatmapFence = heatmapMatches.length > 0

  if (heatmapMatches.length > 1) {
    diagnostics.errors.push(`Multiple loan_review_heatmap_json fences found (${heatmapMatches.length}); using first`)
    diagnostics.skippedBlocks += heatmapMatches.length - 1
  }

  if (hasHeatmapFence) {
    try {
      const parsed = JSON.parse(heatmapMatches[0][1].trim())
      heatmap = {
        riskItems: Array.isArray(parsed.riskItems) ? parsed.riskItems : [],
        stopReview: parsed.stopReview === true,
        stopReason: typeof parsed.stopReason === 'string' ? parsed.stopReason : undefined,
        missingDocs: Array.isArray(parsed.missingDocs) ? parsed.missingDocs : [],
        escalations: Array.isArray(parsed.escalations) ? parsed.escalations : [],
      }
    } catch (e) {
      const snippet = heatmapMatches[0][1].slice(0, 2000)
      diagnostics.errors.push(`Failed to parse heatmap JSON: ${(e as Error).message}; snippet: ${snippet}`)
    }
  } else {
    diagnostics.errors.push('No loan_review_heatmap_json fence found')
  }

  // ── Extract sections from memo ──
  const sections = extractSections(fullText)

  // ── Build parse result ──
  const reviewDepth = 'attorney-prep' // Will be overridden by caller if needed

  return {
    outputs: [
      {
        type: 'loan_review_memo',
        data: {
          fullText,
          heatmap: heatmap ?? null,
          sections,
          reviewDepth,
          hasMemoFence,
          hasHeatmapFence,
        },
      },
    ],
    rawText,
    diagnostics,
  }
}

/**
 * Extract numbered section headers from the memo text.
 */
function extractSections(text: string): Array<{ title: string; content: string }> {
  const sectionRe = /^## \d+\.\s+(.+)$/gm
  const sections: Array<{ title: string; content: string }> = []
  const matches = [...text.matchAll(sectionRe)]

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const title = match[1].trim()
    const startIdx = match.index! + match[0].length
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : text.length
    const content = text.slice(startIdx, endIdx).trim()
    sections.push({ title, content })
  }

  return sections
}
