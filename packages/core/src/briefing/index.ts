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
