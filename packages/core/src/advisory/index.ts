/**
 * Advisory — strategic advisory system for domain-scoped AI.
 * Provides structured reasoning artifacts (brainstorms, risk assessments, scenarios, strategic reviews).
 */

export {
  normalizeEnum,
  normalizePersist,
  normalizeType,
  validateEnum,
} from './normalize.js'
export type {
  AdvisoryRejectReason,
  AdvisoryRejectEntry,
  AdvisoryWarningReason,
  AdvisoryWarningEntry,
} from './normalize.js'

export {
  AdvisoryTypeSchema,
  AdvisoryModeSchema,
  AdvisoryStatusSchema,
  PersistValueSchema,
  AdvisorySourceSchema,
  CURRENT_SCHEMA_VERSION,
  BrainstormPayloadSchema,
  RiskAssessmentPayloadSchema,
  ScenarioPayloadSchema,
  StrategicReviewPayloadSchema,
  PAYLOAD_SCHEMAS,
  AdvisoryArtifactSchema,
  CreateAdvisoryArtifactInputSchema,
} from './schemas.js'

export type {
  AdvisoryType,
  AdvisoryMode,
  AdvisoryStatus,
  PersistValue,
  AdvisorySource,
  BrainstormPayload,
  RiskAssessmentPayload,
  ScenarioPayload,
  StrategicReviewPayload,
  AdvisoryArtifact,
  CreateAdvisoryArtifactInput,
  AdvisoryDraftBlock,
  AdvisoryParseResult,
  SaveDraftBlockInput,
  SaveDraftBlockResult,
  ExtractedTask,
  NeedsEditingTask,
  TurnIntoTasksInput,
  TurnIntoTasksOutput,
} from './schemas.js'

export {
  AdvisoryRepository,
  ADVISORY_MAX_DAILY_ARTIFACTS,
  MAX_ARTIFACTS_PER_HOUR,
} from './repository.js'

export {
  parseAdvisoryBlocks,
  stableStringify,
  computeFingerprint,
  ADVISORY_MAX_PERSIST_PER_RESPONSE,
  ADVISORY_MAX_DRAFT_CAPTURE_PER_MESSAGE,
} from './parser.js'
export type { ParseAdvisoryBlocksOptions } from './parser.js'

export { extractTasksFromArtifact } from './task-extractor.js'
