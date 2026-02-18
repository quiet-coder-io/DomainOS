/**
 * Audit — persistent tracking of KB changes, decisions, and cross-domain reads.
 */

export { AuditRepository } from './repository.js'
export { DecisionRepository } from './decision-repository.js'
export { computeContentHash } from './content-hash.js'
export {
  AuditEntrySchema,
  CreateAuditInputSchema,
  AuditEventTypeSchema,
  DecisionSchema,
  CreateDecisionInputSchema,
  DecisionStatusSchema,
} from './schemas.js'
export type {
  AuditEntry,
  CreateAuditInput,
  AuditEventType,
  Decision,
  CreateDecisionInput,
  DecisionStatus,
} from './schemas.js'
