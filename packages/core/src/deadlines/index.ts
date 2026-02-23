/**
 * Deadline tracking — schemas, repository, and evaluation functions.
 */

export {
  DeadlineStatusSchema,
  DeadlineSourceSchema,
  CreateDeadlineInputSchema,
} from './schemas.js'

export type {
  DeadlineStatus,
  DeadlineSource,
  CreateDeadlineInput,
  Deadline,
} from './schemas.js'

export { DeadlineRepository } from './repository.js'

export {
  todayISO,
  isOverdue,
  daysUntilDue,
  deadlineSeverityWeight,
  categorizeDueDate,
} from './evaluation.js'

export type { DueDateCategory } from './evaluation.js'
