/**
 * Google Tasks client for tool-use: list, search, read, mutate, and overdue detection.
 *
 * Uses OAuth2 with refresh token. Supports read and write operations.
 * No local storage — all data fetched on-demand from Google Tasks API.
 */

import { google } from 'googleapis'
import type { tasks_v1 } from 'googleapis'

export interface GTasksClientConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export interface GTaskList {
  id: string
  title: string
  updated: string
}

export interface GTask {
  id: string
  taskListId: string
  taskListTitle: string
  title: string
  notes: string
  due: string
  status: string
  updated: string
  completed: string
  position: string
  parent: string
}

export interface GTaskSearchResult {
  id: string
  taskListId: string
  taskListTitle: string
  title: string
  due: string
  status: string
  notes: string
}

/** Max tasks returned from search to prevent runaway context. */
const MAX_SEARCH_RESULTS = 100

export class GTasksClient {
  private tasks: tasks_v1.Tasks

  constructor(config: GTasksClientConfig) {
    const auth = new google.auth.OAuth2(config.clientId, config.clientSecret)
    auth.setCredentials({ refresh_token: config.refreshToken })
    this.tasks = google.tasks({ version: 'v1', auth })
  }

  /** Preflight check: validates credentials by listing task lists. */
  async getProfile(): Promise<{ ok: boolean; email?: string }> {
    try {
      await this.tasks.tasklists.list({ maxResults: 1 })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  /** List all task lists. */
  async listTaskLists(): Promise<GTaskList[]> {
    const res = await this.tasks.tasklists.list({ maxResults: 100 })
    return (res.data.items ?? [])
      .filter((l) => l.id && l.title)
      .map((l) => ({
        id: l.id!,
        title: l.title!,
        updated: l.updated ?? '',
      }))
  }

  /**
   * Search tasks across lists with optional filtering.
   * Google Tasks API doesn't support text search, so we fetch all and filter client-side.
   * Limited to MAX_SEARCH_RESULTS to prevent context blowup.
   */
  async search(opts?: {
    listName?: string
    showCompleted?: boolean
    maxResults?: number
  }): Promise<GTaskSearchResult[]> {
    const maxResults = Math.min(opts?.maxResults ?? 20, 50)
    const showCompleted = opts?.showCompleted ?? false

    const lists = await this.listTaskLists()
    const targetLists = opts?.listName
      ? lists.filter((l) => l.title.toLowerCase().includes(opts.listName!.toLowerCase()))
      : lists

    if (targetLists.length === 0 && opts?.listName) {
      return []
    }

    const results: GTaskSearchResult[] = []

    for (const list of targetLists) {
      if (results.length >= MAX_SEARCH_RESULTS) break

      try {
        const res = await this.tasks.tasks.list({
          tasklist: list.id,
          showCompleted,
          showHidden: false,
          maxResults: 100,
        })

        for (const task of res.data.items ?? []) {
          if (!task.id || !task.title) continue
          if (results.length >= MAX_SEARCH_RESULTS) break

          results.push({
            id: task.id,
            taskListId: list.id,
            taskListTitle: list.title,
            title: task.title,
            due: task.due ?? '',
            status: task.status ?? 'needsAction',
            notes: (task.notes ?? '').slice(0, 500),
          })
        }
      } catch {
        // Skip lists that fail (e.g., permissions)
      }
    }

    return results.slice(0, maxResults)
  }

  /** Read full task details by list ID and task ID. */
  async read(taskListId: string, taskId: string): Promise<GTask | null> {
    try {
      const listTitle = await this.getTaskListTitle(taskListId)

      const res = await this.tasks.tasks.get({
        tasklist: taskListId,
        task: taskId,
      })

      const task = res.data
      if (!task.id) return null

      return {
        id: task.id,
        taskListId,
        taskListTitle: listTitle,
        title: task.title ?? '',
        notes: task.notes ?? '',
        due: task.due ?? '',
        status: task.status ?? 'needsAction',
        updated: task.updated ?? '',
        completed: task.completed ?? '',
        position: task.position ?? '',
        parent: task.parent ?? '',
      }
    } catch {
      return null
    }
  }

  /** Get all overdue active tasks across all lists. */
  async getOverdue(): Promise<GTaskSearchResult[]> {
    const today = new Date()
    // Set to start of day in UTC for consistent comparison with Google Tasks due dates
    today.setUTCHours(0, 0, 0, 0)

    const lists = await this.listTaskLists()
    const overdue: GTaskSearchResult[] = []

    for (const list of lists) {
      try {
        const res = await this.tasks.tasks.list({
          tasklist: list.id,
          showCompleted: false,
          showHidden: false,
          maxResults: 100,
        })

        for (const task of res.data.items ?? []) {
          if (!task.id || !task.title || !task.due) continue
          if (task.status === 'completed') continue

          // Google Tasks due dates are RFC 3339 with time set to 00:00:00.000Z
          const dueDate = new Date(task.due)
          if (dueDate < today) {
            overdue.push({
              id: task.id,
              taskListId: list.id,
              taskListTitle: list.title,
              title: task.title,
              due: task.due,
              status: task.status ?? 'needsAction',
              notes: (task.notes ?? '').slice(0, 500),
            })
          }
        }
      } catch {
        // Skip lists that fail
      }
    }

    return overdue
  }

  /** Mark a task as completed. Returns updated task or throws on error. */
  async completeTask(taskListId: string, taskId: string): Promise<GTask> {
    const listTitle = await this.getTaskListTitle(taskListId)

    const res = await this.tasks.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody: { status: 'completed' },
    })

    const task = res.data
    if (!task.id) throw new Error('Google Tasks API returned no task ID')

    return {
      id: task.id,
      taskListId,
      taskListTitle: listTitle,
      title: task.title ?? '',
      notes: task.notes ?? '',
      due: task.due ?? '',
      status: task.status ?? 'completed',
      updated: task.updated ?? '',
      completed: task.completed ?? '',
      position: task.position ?? '',
      parent: task.parent ?? '',
    }
  }

  /** Update a task's title, notes, or due date. Returns updated task or throws on error. */
  async updateTask(
    taskListId: string,
    taskId: string,
    updates: { title?: string; notes?: string; due?: string },
  ): Promise<GTask> {
    const listTitle = await this.getTaskListTitle(taskListId)

    const res = await this.tasks.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody: updates,
    })

    const task = res.data
    if (!task.id) throw new Error('Google Tasks API returned no task ID')

    return {
      id: task.id,
      taskListId,
      taskListTitle: listTitle,
      title: task.title ?? '',
      notes: task.notes ?? '',
      due: task.due ?? '',
      status: task.status ?? 'needsAction',
      updated: task.updated ?? '',
      completed: task.completed ?? '',
      position: task.position ?? '',
      parent: task.parent ?? '',
    }
  }

  /** Delete a task. Throws on error. */
  async deleteTask(taskListId: string, taskId: string): Promise<void> {
    await this.tasks.tasks.delete({
      tasklist: taskListId,
      task: taskId,
    })
  }

  private async getTaskListTitle(listId: string): Promise<string> {
    try {
      const res = await this.tasks.tasklists.get({ tasklist: listId })
      return res.data.title ?? ''
    } catch {
      return ''
    }
  }
}
