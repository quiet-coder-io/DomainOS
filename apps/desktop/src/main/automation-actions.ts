/**
 * Automation action executors.
 * Each action type takes the AI response and produces a side effect.
 */

import type { BrowserWindow } from 'electron'
import type { Automation } from '@domain-os/core'
import type { GTasksClient } from '@domain-os/integrations'

export interface ActionDeps {
  mainWindow: BrowserWindow | null
  getGTasksClient: () => Promise<GTasksClient | null>
  checkGmailComposeScope: () => Promise<boolean>
  createGmailDraft: (to: string, subject: string, body: string) => Promise<string>
}

export interface ActionResult {
  result: string
  externalId?: string
  errorCode?: string
}

export async function executeAction(
  automation: Automation,
  aiResponse: string,
  deps: ActionDeps,
): Promise<ActionResult> {
  switch (automation.actionType) {
    case 'notification':
      return executeNotification(automation, aiResponse, deps)
    case 'create_gtask':
      return executeCreateGTask(automation, aiResponse, deps)
    case 'draft_gmail':
      return executeDraftGmail(automation, aiResponse, deps)
    default:
      return { result: '', errorCode: 'invalid_action_config' }
  }
}

function executeNotification(
  automation: Automation,
  aiResponse: string,
  deps: ActionDeps,
): ActionResult {
  const message = aiResponse.slice(0, 500)
  deps.mainWindow?.webContents.send('automation:notification', {
    automationId: automation.id,
    automationName: automation.name,
    domainId: automation.domainId,
    message,
  })
  return { result: `Notification sent: ${message.slice(0, 80)}...` }
}

async function executeCreateGTask(
  automation: Automation,
  aiResponse: string,
  deps: ActionDeps,
): Promise<ActionResult> {
  const client = await deps.getGTasksClient()
  if (!client) {
    return { result: '', errorCode: 'gtasks_not_connected' }
  }

  let config: { taskListId?: string } = {}
  try {
    config = JSON.parse(automation.actionConfig)
  } catch { /* use defaults */ }

  // Determine task list — use configured or first available
  let taskListId = config.taskListId
  if (!taskListId) {
    const lists = await client.listTaskLists()
    if (lists.length === 0) {
      return { result: 'No task lists found', errorCode: 'gtasks_not_connected' }
    }
    taskListId = lists[0].id
  }

  // First line as title, full response as notes
  const lines = aiResponse.split('\n').filter(l => l.trim())
  const title = (lines[0] || 'Automation result').slice(0, 200)
  const notes = aiResponse.slice(0, 8000)

  const task = await client.createTask(taskListId, title, notes)
  return {
    result: `Task created: ${title}`,
    externalId: task.id,
  }
}

async function executeDraftGmail(
  automation: Automation,
  aiResponse: string,
  deps: ActionDeps,
): Promise<ActionResult> {
  const hasScope = await deps.checkGmailComposeScope()
  if (!hasScope) {
    return { result: '', errorCode: 'missing_oauth_scope' }
  }

  let config: { to?: string; subject?: string } = {}
  try {
    config = JSON.parse(automation.actionConfig)
  } catch { /* use defaults */ }

  const to = config.to || ''
  const subject = config.subject || `[DomainOS] ${automation.name}`
  const body = aiResponse.slice(0, 50000)

  if (!to) {
    return { result: 'No recipient configured', errorCode: 'invalid_action_config' }
  }

  const draftId = await deps.createGmailDraft(to, subject, body)
  return {
    result: `Gmail draft created for ${to}`,
    externalId: draftId,
  }
}
