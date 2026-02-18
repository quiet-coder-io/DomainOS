/**
 * Google Tasks-specific types for the integration reader.
 */

export interface GTasksReaderConfig {
  /** OAuth2 credentials */
  clientId: string
  clientSecret: string
  refreshToken: string
  /** Intake endpoint config */
  intakeUrl: string
  intakeToken: string
  /** Poll interval in ms (default: 300000 = 5 minutes) */
  pollIntervalMs?: number
  /** Task list IDs to monitor (empty = all lists) */
  taskListIds?: string[]
}

export interface GTaskMeta {
  taskId: string
  taskListId: string
  taskListTitle: string
  due: string
  status: string
  updated: string
}
