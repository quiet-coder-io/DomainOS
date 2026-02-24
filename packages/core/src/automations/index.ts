/**
 * Automations module — scheduled, event-driven, and manual automation rules.
 */

export {
  TriggerTypeEnum,
  TriggerEventEnum,
  ActionTypeEnum,
  NotificationConfigSchema,
  GTaskConfigSchema,
  GmailConfigSchema,
  CreateAutomationInputSchema,
  UpdateAutomationInputSchema,
} from './schemas.js'
export type {
  TriggerType,
  TriggerEvent,
  ActionType,
  CreateAutomationInput,
  UpdateAutomationInput,
  Automation,
  RunStatus,
  AutomationErrorCode,
  AutomationRun,
} from './schemas.js'

export {
  matchesCron,
  validateCron,
  lastCronMatch,
  describeHumanReadable,
} from './cron.js'

// stableStringify and stableHash not re-exported here to avoid collision
// with advisory module. Import directly from './dedupe.js' when needed.
export {
  materializeDedupePayload,
  generateDedupeKey,
} from './dedupe.js'

export {
  renderPromptTemplate,
  extractTemplateVars,
} from './template.js'

export { AutomationRepository } from './repository.js'
