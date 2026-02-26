/**
 * Mission output parser interface and registry.
 *
 * Each mission type registers a parser that converts raw LLM text
 * into structured outputs. The registry avoids switch-statement
 * explosion when adding new mission types.
 */

import { parseBriefingAnalysis } from '../briefing/output-parser.js'
import { parseLoanReview } from '../loan-review/output-parser.js'
import type { MissionOutputType } from './schemas.js'

// ── Parser interface ──

export interface MissionOutputParser {
  parse(rawText: string): MissionParseResult
}

export interface MissionParseResult {
  outputs: Array<{ type: MissionOutputType; data: Record<string, unknown> }>
  rawText: string
  diagnostics: { skippedBlocks: number; errors: string[] }
}

// ── Registry ──

const parsers = new Map<string, MissionOutputParser>()

export function registerOutputParser(missionId: string, parser: MissionOutputParser): void {
  parsers.set(missionId, parser)
}

export function getOutputParser(missionId: string): MissionOutputParser | undefined {
  return parsers.get(missionId)
}

// ── Portfolio Briefing parser (wraps existing parseBriefingAnalysis) ──

registerOutputParser('portfolio-briefing', {
  parse(rawText: string): MissionParseResult {
    const result = parseBriefingAnalysis(rawText)
    return {
      outputs: [
        ...result.alerts.map((a) => ({ type: 'alert' as const, data: a as unknown as Record<string, unknown> })),
        ...result.actions.map((a) => ({ type: 'action' as const, data: a as unknown as Record<string, unknown> })),
        ...result.monitors.map((m) => ({ type: 'monitor' as const, data: m as unknown as Record<string, unknown> })),
      ],
      rawText,
      diagnostics: result.diagnostics,
    }
  },
})

// ── Loan Document Review parser ──

registerOutputParser('loan-document-review', {
  parse(rawText: string): MissionParseResult {
    return parseLoanReview(rawText)
  },
})

/**
 * Call once at startup to ensure all parsers are registered.
 * Importing this module triggers registration via the top-level
 * `registerOutputParser()` call above, but this function exists
 * as an explicit initialization point to avoid import-order issues.
 */
export function initMissionParsers(): void {
  // Registration happens at module evaluation time above.
  // This function is a no-op but guarantees the module is loaded.
}
