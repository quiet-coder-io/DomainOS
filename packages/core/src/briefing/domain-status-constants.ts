/**
 * Constants for domain status briefing — single source of truth for all caps, weights, and limits.
 * Used by domain-status.ts (computation) and prompt-builder.ts (rendering).
 */

// Item caps per section
export const STATUS_CAPS = {
  topActions: 8,
  overdueDeadlines: 6,
  upcomingDeadlines: 6,
  openGapFlags: 6,
  resolvedGapFlags: 4,
  auditEvents: 10,
  decisions: 5,
  artifacts: 4,
} as const

// Per-item char truncation limits (applied at render time)
export const STATUS_CHAR_LIMITS = {
  deadlineText: 120,
  gapDescription: 120,
  decisionText: 160,
  auditDescription: 140,
  artifactTitle: 100,
  actionText: 100,
  actionRationale: 60,
  keyword: 24,
} as const

// Soft cap: stop adding optional sections proactively
export const STATUS_SOFT_CAP_CHARS = 3_100

// Hard cap for entire rendered briefing section
export const STATUS_MAX_SECTION_CHARS = 3_400

// Gap flag category weights for priority scoring
export const GAP_CATEGORY_WEIGHTS: Record<string, number> = {
  blocker: 15,
  security: 15,
  legal: 15,
  compliance: 12,
  financial: 10,
  data: 8,
  process: 5,
  documentation: 3,
} as const

export const GAP_DEFAULT_WEIGHT = 0

// Gap category synonym mapping (applied after normalizeGapCategory base normalization)
export const GAP_CATEGORY_SYNONYMS: Record<string, string> = {
  'legal risk': 'legal',
  'security incident': 'security',
  'finance': 'financial',
  'doc': 'documentation',
  'docs': 'documentation',
  'block': 'blocker',
} as const

// Priority semantics: 1 = highest urgency, 7 = lowest (range 1-7, default 4)
export const PRIORITY_MAX = 7
export const PRIORITY_DEFAULT = 4

// Priority scoring formulas
export const SCORING = {
  deadlineBase: 50,
  deadlinePerDay: 3,
  deadlinePerPriority: 5,
  gapBase: 30,
  gapAgeBonus: 10,
  gapAgeDays: 14,
  kbBase: 20,
  kbPerDay: 0.33,
} as const

// Keyword extraction stopwords
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'this', 'that', 'these',
  'those', 'it', 'its', 'not', 'no', 'all', 'each', 'every', 'any',
])
