/**
 * Token budget constants and estimation for prompt construction.
 * All budget enforcement uses estimateTokens() — no raw char-based checks.
 */

/** Convert character count to estimated token count (1 token ≈ 4 chars). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/** Section-level token budgets for system prompt construction. */
export const TOKEN_BUDGETS = {
  /** Total prompt budget */
  total: 32_000,
  /** Agent identity section */
  identity: 1_000,
  /** Session context (startup report, scope, gap flags) */
  session: 500,
  /** Global cap for all sibling digests combined */
  siblingGlobal: 4_000,
  /** Per-sibling digest cap */
  siblingPerDomain: 1_500,
  /** Shared protocols section */
  sharedProtocols: 2_000,
  /** Domain-specific protocols section */
  domainProtocols: 2_000,
  /** Escalation triggers section */
  escalation: 500,
  /** KB update instructions format spec */
  kbInstructions: 500,
  /** Primary KB content (remainder after all other sections) */
  primaryKB: 21_500,
} as const
