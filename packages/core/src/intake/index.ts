/**
 * Intake — browser-to-app content ingestion pipeline.
 * Handles receiving, classifying, and routing external content to domains.
 */

export { IntakeRepository } from './repository.js'
export {
  CreateIntakeItemInputSchema,
  IntakeItemSchema,
  ClassifyResultSchema,
  MAX_INTAKE_CONTENT_BYTES,
} from './schemas.js'
export type {
  IntakeItem,
  CreateIntakeItemInput,
  IntakeStatus,
  ClassifyResult,
} from './schemas.js'
export { classifyContent } from './classifier.js'
