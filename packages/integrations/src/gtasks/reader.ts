/**
 * Google Tasks reader — fetches tasks and posts them to the DomainOS intake endpoint.
 *
 * Uses Google APIs OAuth2 for authentication. Polls on a configurable interval.
 * Deduplicates via external_id (GTasks task ID) before posting.
 */

import { google } from 'googleapis'
import type { tasks_v1 } from 'googleapis'
import { IntakeClient } from '../common/intake-client.js'
import type { GTasksReaderConfig, GTaskMeta } from './types.js'

export class GTasksReader {
  private client: IntakeClient
  private tasks: tasks_v1.Tasks
  private timer: ReturnType<typeof setInterval> | null = null
  private config: Required<Pick<GTasksReaderConfig, 'pollIntervalMs' | 'taskListIds'>> &
    GTasksReaderConfig

  constructor(config: GTasksReaderConfig) {
    this.config = {
      ...config,
      pollIntervalMs: config.pollIntervalMs ?? 300_000,
      taskListIds: config.taskListIds ?? [],
    }

    this.client = new IntakeClient(config.intakeUrl, config.intakeToken)

    const auth = new google.auth.OAuth2(config.clientId, config.clientSecret)
    auth.setCredentials({ refresh_token: config.refreshToken })
    this.tasks = google.tasks({ version: 'v1', auth })
  }

  async start(): Promise<void> {
    await this.poll()
    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async poll(): Promise<number> {
    let posted = 0

    try {
      const taskListIds = await this.resolveTaskListIds()

      for (const listId of taskListIds) {
        const listTitle = await this.getTaskListTitle(listId)
        const tasks = await this.fetchTasks(listId)

        for (const task of tasks) {
          if (!task.id || !task.title) continue

          const exists = await this.client.checkDuplicate('gtasks', task.id)
          if (exists) continue

          const meta: GTaskMeta = {
            taskId: task.id,
            taskListId: listId,
            taskListTitle: listTitle,
            due: task.due ?? '',
            status: task.status ?? 'needsAction',
            updated: task.updated ?? '',
          }

          const result = await this.client.post({
            title: task.title,
            content: task.notes || task.title,
            sourceType: 'gtasks',
            externalId: task.id,
            metadata: {
              taskListId: meta.taskListId,
              taskListTitle: meta.taskListTitle,
              due: meta.due,
              status: meta.status,
              updated: meta.updated,
            },
          })

          if (result.ok) posted++
        }
      }
    } catch (e) {
      console.error('[GTasksReader] poll error:', (e as Error).message)
    }

    return posted
  }

  private async resolveTaskListIds(): Promise<string[]> {
    if (this.config.taskListIds.length > 0) {
      return this.config.taskListIds
    }

    const res = await this.tasks.tasklists.list({ maxResults: 100 })
    return (res.data.items ?? []).map((l) => l.id!).filter(Boolean)
  }

  private async getTaskListTitle(listId: string): Promise<string> {
    try {
      const res = await this.tasks.tasklists.get({ tasklist: listId })
      return res.data.title ?? ''
    } catch {
      return ''
    }
  }

  private async fetchTasks(listId: string): Promise<tasks_v1.Schema$Task[]> {
    try {
      const res = await this.tasks.tasks.list({
        tasklist: listId,
        showCompleted: false,
        showHidden: false,
        maxResults: 100,
      })
      return res.data.items ?? []
    } catch {
      return []
    }
  }
}
