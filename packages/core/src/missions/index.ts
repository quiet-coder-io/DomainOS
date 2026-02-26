/**
 * Mission system — definitions, runs, gates, actions, output parsing.
 */

export {
  MissionRunStatusSchema,
  MissionGateStatusSchema,
  MissionActionStatusSchema,
  MissionActionTypeSchema,
  MissionOutputTypeSchema,
  ProviderNameSchema,
  CreateMissionRunInputSchema,
  GateDecisionInputSchema,
} from './schemas.js'

export type {
  MissionRunStatus,
  MissionGateStatus,
  MissionActionStatus,
  MissionActionType,
  MissionOutputType,
  MissionProviderName,
  MissionDefinition,
  Mission,
  MissionDomainAssoc,
  MissionRun,
  MissionRunOutput,
  MissionRunGate,
  MissionRunAction,
  CreateMissionRunInput,
  GateDecisionInput,
  MissionSummary,
  MissionRunSummary,
  MissionRunDetail,
  MissionContextSnapshot,
} from './schemas.js'

export { MissionRepository, computeDefinitionHash, deepSortKeys } from './repository.js'

export { MissionRunRepository } from './run-repository.js'

export {
  registerOutputParser,
  getOutputParser,
  initMissionParsers,
} from './output-parser.js'

export type {
  MissionOutputParser,
  MissionParseResult,
} from './output-parser.js'

export { MissionRunner } from './runner.js'

export type {
  MissionRunnerDeps,
  MissionProgressEvent,
  MissionContext,
  MissionContextSnapshotPartial,
  GateEvaluation,
} from './runner.js'

// Ensure parsers are registered on module load
import { initMissionParsers } from './output-parser.js'
initMissionParsers()
