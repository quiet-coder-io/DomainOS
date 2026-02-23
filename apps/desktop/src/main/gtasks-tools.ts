/**
 * Google Tasks tool definitions, input validation, and executor for LLM tool-use.
 *
 * Defines two tools (gtasks_search, gtasks_read) and validates/executes
 * them against the GTasksClient. All errors are returned as strings (never thrown)
 * to ensure tool results are always emitted.
 *
 * Uses provider-agnostic ToolDefinition type — no Anthropic import needed.
 */

import type { GTasksClient } from '@domain-os/integrations'
import type { ToolDefinition } from '@domain-os/core'

/** Maximum size for any tool result string (prevents context blowup). */
const MAX_RESULT_SIZE = 12_000

export const GTASKS_TOOLS: ToolDefinition[] = [
  {
    name: 'gtasks_search',
    description:
      'Search Google Tasks. Returns task title, due date, status, list name, and IDs for each result. Use list_name to filter to a specific list.',
    inputSchema: {
      type: 'object',
      properties: {
        list_name: {
          type: 'string',
          description: 'Filter to a specific task list by name (partial match, case-insensitive). Omit to search all lists.',
        },
        show_completed: {
          type: 'boolean',
          description: 'Include completed tasks (default: false)',
        },
        max_results: {
          type: 'number',
          description: 'Max results 1-50, default 20',
        },
      },
      required: [],
    },
  },
  {
    name: 'gtasks_read',
    description:
      'Read the full details of a Google Task by its list ID and task ID (from gtasks_search results).',
    inputSchema: {
      type: 'object',
      properties: {
        task_list_id: {
          type: 'string',
          description: 'Task list ID from search results',
        },
        task_id: {
          type: 'string',
          description: 'Task ID from search results',
        },
      },
      required: ['task_list_id', 'task_id'],
    },
  },
  {
    name: 'gtasks_complete',
    description:
      'Mark a Google Task as completed. Requires task_list_id and task_id (from gtasks_search results).',
    inputSchema: {
      type: 'object',
      properties: {
        task_list_id: {
          type: 'string',
          description: 'Task list ID from search results',
        },
        task_id: {
          type: 'string',
          description: 'Task ID from search results',
        },
      },
      required: ['task_list_id', 'task_id'],
    },
  },
  {
    name: 'gtasks_update',
    description:
      'Update a Google Task\'s title, notes, or due date. Requires task_list_id and task_id. At least one of title, notes, or due must be provided.',
    inputSchema: {
      type: 'object',
      properties: {
        task_list_id: {
          type: 'string',
          description: 'Task list ID from search results',
        },
        task_id: {
          type: 'string',
          description: 'Task ID from search results',
        },
        title: {
          type: 'string',
          description: 'New task title (optional)',
        },
        notes: {
          type: 'string',
          description: 'New task notes (optional)',
        },
        due: {
          type: 'string',
          description: 'New due date in RFC 3339 format, e.g. "2025-03-15T00:00:00.000Z" (optional)',
        },
      },
      required: ['task_list_id', 'task_id'],
    },
  },
  {
    name: 'gtasks_delete',
    description:
      'Delete a Google Task. This is permanent and cannot be undone. Requires task_list_id and task_id (from gtasks_search results).',
    inputSchema: {
      type: 'object',
      properties: {
        task_list_id: {
          type: 'string',
          description: 'Task list ID from search results',
        },
        task_id: {
          type: 'string',
          description: 'Task ID from search results',
        },
      },
      required: ['task_list_id', 'task_id'],
    },
  },
]

/**
 * Execute a Google Tasks tool call. Always returns a string (never throws).
 * Errors are prefixed with "GTASKS_ERROR:" for stable detection.
 */
export async function executeGTasksTool(
  client: GTasksClient,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    let result: string

    if (name === 'gtasks_search') {
      result = await executeSearch(client, input)
    } else if (name === 'gtasks_read') {
      result = await executeRead(client, input)
    } else if (name === 'gtasks_complete') {
      result = await executeComplete(client, input)
    } else if (name === 'gtasks_update') {
      result = await executeUpdate(client, input)
    } else if (name === 'gtasks_delete') {
      result = await executeDelete(client, input)
    } else {
      result = `GTASKS_ERROR: unknown_tool — ${name}`
    }

    // Final size guard
    if (result.length > MAX_RESULT_SIZE) {
      result = result.slice(0, MAX_RESULT_SIZE) + '\n[result truncated]'
    }

    return result
  } catch (e) {
    return formatGTasksError(e)
  }
}

async function executeSearch(
  client: GTasksClient,
  input: Record<string, unknown>,
): Promise<string> {
  const listName = typeof input.list_name === 'string' ? input.list_name.trim() : undefined
  const showCompleted = input.show_completed === true

  let maxResults = 20
  if (input.max_results != null) {
    const n = Number(input.max_results)
    if (!isNaN(n)) {
      maxResults = Math.min(50, Math.max(1, Math.round(n)))
    }
  }

  const results = await client.search({
    listName: listName || undefined,
    showCompleted,
    maxResults,
  })

  if (results.length === 0) {
    return 'GTASKS_SEARCH_RESULTS (n=0)\nNo tasks found.'
  }

  const lines = results.map(
    (r) =>
      `- taskId: ${r.id} | taskListId: ${r.taskListId} | list: ${r.taskListTitle} | title: ${r.title} | due: ${r.due || '(none)'} | status: ${r.status}`,
  )

  const json = JSON.stringify(
    results.map((r) => ({
      taskId: r.id,
      taskListId: r.taskListId,
      taskListTitle: r.taskListTitle,
      title: r.title,
      due: r.due,
      status: r.status,
    })),
  )

  return [
    `GTASKS_SEARCH_RESULTS (n=${results.length})`,
    ...lines,
    '--- JSON START ---',
    json,
    '--- JSON END ---',
  ].join('\n')
}

async function executeRead(
  client: GTasksClient,
  input: Record<string, unknown>,
): Promise<string> {
  const taskListId = input.task_list_id
  if (typeof taskListId !== 'string' || !taskListId.trim()) {
    return 'GTASKS_ERROR: validation — task_list_id must be a non-empty string.'
  }

  const taskId = input.task_id
  if (typeof taskId !== 'string' || !taskId.trim()) {
    return 'GTASKS_ERROR: validation — task_id must be a non-empty string.'
  }

  const task = await client.read(taskListId.trim(), taskId.trim())
  if (!task) {
    return 'GTASKS_ERROR: not_found — Task not found or inaccessible.'
  }

  const dueLine = task.due
    ? `Due: ${task.due.slice(0, 10)}`
    : 'Due: (none)'

  return [
    'GTASKS_TASK',
    `Title: ${task.title}`,
    `List: ${task.taskListTitle}`,
    `Status: ${task.status}`,
    dueLine,
    `Updated: ${task.updated}`,
    task.completed ? `Completed: ${task.completed}` : '',
    '--- NOTES ---',
    task.notes || '(no notes)',
    '--- END ---',
  ].filter(Boolean).join('\n')
}

async function executeComplete(
  client: GTasksClient,
  input: Record<string, unknown>,
): Promise<string> {
  const taskListId = input.task_list_id
  if (typeof taskListId !== 'string' || !taskListId.trim()) {
    return 'GTASKS_ERROR: validation — task_list_id must be a non-empty string.'
  }

  const taskId = input.task_id
  if (typeof taskId !== 'string' || !taskId.trim()) {
    return 'GTASKS_ERROR: validation — task_id must be a non-empty string.'
  }

  const task = await client.completeTask(taskListId.trim(), taskId.trim())

  return [
    'GTASKS_TASK_COMPLETED',
    `Title: ${task.title}`,
    `List: ${task.taskListTitle}`,
    `Status: ${task.status}`,
  ].join('\n')
}

async function executeUpdate(
  client: GTasksClient,
  input: Record<string, unknown>,
): Promise<string> {
  const taskListId = input.task_list_id
  if (typeof taskListId !== 'string' || !taskListId.trim()) {
    return 'GTASKS_ERROR: validation — task_list_id must be a non-empty string.'
  }

  const taskId = input.task_id
  if (typeof taskId !== 'string' || !taskId.trim()) {
    return 'GTASKS_ERROR: validation — task_id must be a non-empty string.'
  }

  const updates: { title?: string; notes?: string; due?: string } = {}
  if (typeof input.title === 'string' && input.title.trim()) updates.title = input.title.trim()
  if (typeof input.notes === 'string') updates.notes = input.notes
  if (typeof input.due === 'string' && input.due.trim()) updates.due = input.due.trim()

  if (Object.keys(updates).length === 0) {
    return 'GTASKS_ERROR: validation — At least one of title, notes, or due must be provided.'
  }

  const task = await client.updateTask(taskListId.trim(), taskId.trim(), updates)
  const dueLine = task.due ? `Due: ${task.due.slice(0, 10)}` : 'Due: (none)'

  return [
    'GTASKS_TASK_UPDATED',
    `Title: ${task.title}`,
    `List: ${task.taskListTitle}`,
    `Status: ${task.status}`,
    dueLine,
    task.notes ? `Notes: ${task.notes.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n')
}

async function executeDelete(
  client: GTasksClient,
  input: Record<string, unknown>,
): Promise<string> {
  const taskListId = input.task_list_id
  if (typeof taskListId !== 'string' || !taskListId.trim()) {
    return 'GTASKS_ERROR: validation — task_list_id must be a non-empty string.'
  }

  const taskId = input.task_id
  if (typeof taskId !== 'string' || !taskId.trim()) {
    return 'GTASKS_ERROR: validation — task_id must be a non-empty string.'
  }

  await client.deleteTask(taskListId.trim(), taskId.trim())

  return 'GTASKS_TASK_DELETED\nTask deleted successfully.'
}

function formatGTasksError(e: unknown): string {
  if (!(e instanceof Error)) return `GTASKS_ERROR: unknown — ${String(e)}`

  const msg = e.message
  const anyErr = e as { code?: number; errors?: Array<{ reason?: string }> }
  const code = anyErr.code
  const reason = anyErr.errors?.[0]?.reason ?? ''

  if (code === 429 || (code === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'))) {
    return 'GTASKS_ERROR: rate_limited — Try again in a minute.'
  }

  if (code === 403 && (reason === 'insufficientPermissions' || reason === 'forbidden')) {
    return 'GTASKS_ERROR: insufficient_permissions — Reconnect and approve Google Tasks access.'
  }

  if (code === 403) {
    return 'GTASKS_ERROR: forbidden — Permission denied or Tasks API disabled.'
  }

  if (code === 401 || msg.includes('invalid_grant')) {
    return 'GTASKS_ERROR: invalid_grant — Token expired or revoked. Please reconnect Google Tasks.'
  }

  return `GTASKS_ERROR: api — ${msg}`
}
