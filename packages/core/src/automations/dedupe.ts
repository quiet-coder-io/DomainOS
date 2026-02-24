import { createHash } from 'node:crypto'

/**
 * Recursive sorted-key JSON serialization for deterministic output.
 * Handles primitives, arrays, and plain objects. Other types become null.
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null'
  if (typeof obj === 'string') return JSON.stringify(obj)
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj)

  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']'
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort()
    const pairs = keys.map(k => {
      return JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])
    })
    return '{' + pairs.join(',') + '}'
  }

  return 'null'
}

/**
 * SHA-256 hash of the stable-stringified object.
 */
export function stableHash(obj: unknown): string {
  return createHash('sha256').update(stableStringify(obj)).digest('hex')
}

/**
 * Per-event-type payload extraction for stable hashing.
 * Extracts only the fields relevant for deduplication.
 */
export function materializeDedupePayload(
  eventType: string,
  eventData: Record<string, unknown>,
): Record<string, unknown> {
  switch (eventType) {
    case 'intake_created':
      return {
        entityId: eventData.entityId,
        entityType: eventData.entityType,
      }
    case 'kb_changed':
      return {
        entityId: eventData.entityId,
        entityType: eventData.entityType,
        changedPaths: Array.isArray(eventData.changedPaths)
          ? [...eventData.changedPaths].sort()
          : [],
      }
    case 'gap_flag_raised':
      return {
        entityId: eventData.entityId,
        entityType: eventData.entityType,
        severity: eventData.severity,
      }
    case 'deadline_approaching':
      return {
        entityId: eventData.deadlineId ?? eventData.entityId,
        entityType: 'deadline',
        dueDate: eventData.dueDate,
      }
    default:
      return eventData
  }
}

/**
 * Generate a deduplication key for an automation run.
 *
 * - Schedule: {automationId}|{minuteKey}
 * - Event: {automationId}|{eventType}|{payloadHash}|{minuteKey}
 * - Manual: {automationId}|manual|{requestId}
 */
export function generateDedupeKey(
  automationId: string,
  triggerType: string,
  context: {
    minuteKey: string
    eventType?: string
    eventData?: Record<string, unknown>
    requestId?: string
  },
): string {
  switch (triggerType) {
    case 'schedule':
      return `${automationId}|${context.minuteKey}`

    case 'event': {
      const eventType = context.eventType ?? 'unknown'
      const payload = context.eventData
        ? materializeDedupePayload(eventType, context.eventData)
        : {}
      const payloadHash = stableHash(payload)
      return `${automationId}|${eventType}|${payloadHash}|${context.minuteKey}`
    }

    case 'manual':
      return `${automationId}|manual|${context.requestId ?? 'none'}`

    default:
      return `${automationId}|${triggerType}|${context.minuteKey}`
  }
}
