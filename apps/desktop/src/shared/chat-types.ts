/**
 * Shared chat event types — imported by main, preload, and renderer.
 * Single source of truth for ToolUseEvent shape across process boundaries.
 */

export interface ToolUseEvent {
  requestId: string
  toolName: string
  toolUseId: string
  status: 'running' | 'done'
  domainId: string
  roundIndex: number
  detail?: {
    query?: string
    resultCount?: number
    messageId?: string
    subject?: string
    taskId?: string
    taskListTitle?: string
  }
}
