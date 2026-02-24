/**
 * Portfolio briefing — computed health metrics and analysis.
 */

export {
  computePortfolioHealth,
  computeSnapshotHash,
  fileWeight,
  hasStructuralBlock,
} from './portfolio-health.js'

export type {
  DomainStatus,
  DomainHealth,
  StaleSummary,
  CrossDomainAlert,
  PortfolioHealth,
} from './portfolio-health.js'

export {
  buildBriefingPrompt,
  projectPortfolioHealthForLLM,
  redactForLLM,
} from './prompt-builder.js'

export type {
  BriefingPromptContext,
  ProjectedHealthV1,
} from './prompt-builder.js'

export {
  parseBriefingAnalysis,
} from './output-parser.js'

export type {
  BriefingAlert,
  BriefingAction,
  BriefingMonitor,
  ParseDiagnostics,
  BriefingParseResult,
} from './output-parser.js'

export {
  computeDomainStatusSnapshot,
  computeSinceWindow,
  computeTopActions,
  computeSearchHints,
  normalizeGapCategory,
  sanitizeKeyword,
  extractKeywordsFromText,
} from './domain-status.js'

export type {
  SinceWindow,
  SearchHints,
  RankedAction,
  DomainStatusSnapshot,
} from './domain-status.js'

export {
  STATUS_CAPS,
  STATUS_CHAR_LIMITS,
  STATUS_SOFT_CAP_CHARS,
  STATUS_MAX_SECTION_CHARS,
  GAP_CATEGORY_WEIGHTS,
  GAP_DEFAULT_WEIGHT,
  GAP_CATEGORY_SYNONYMS,
  PRIORITY_MAX,
  PRIORITY_DEFAULT,
  SCORING,
  STOPWORDS,
} from './domain-status-constants.js'
