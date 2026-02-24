/**
 * In-process automation event bus.
 * Decouples event emitters (intake, KB watcher, gap flags) from the automation engine.
 */

import { EventEmitter } from 'node:events'

// ── Event types ──

export type AutomationEventType =
  | 'intake_created'
  | 'kb_changed'
  | 'gap_flag_raised'
  | 'deadline_approaching'

export interface AutomationEventData {
  entityId: string
  entityType: string
  summary: string
  metadata?: Record<string, unknown>
}

export interface AutomationEvent {
  type: AutomationEventType
  domainId: string
  data: AutomationEventData
}

// ── Bus ──

const MAX_DATA_BYTES = 20_000
const EVENT_NAME = 'automation-event'

const bus = new EventEmitter()
bus.setMaxListeners(50) // allow multiple engine listeners

export type AutomationEventHandler = (event: AutomationEvent) => void

export function emitAutomationEvent(event: AutomationEvent): void {
  // Cap data size to prevent memory abuse
  const serialized = JSON.stringify(event.data)
  if (serialized.length > MAX_DATA_BYTES) {
    console.warn(`[automation-events] Event data exceeds ${MAX_DATA_BYTES} bytes, truncating metadata`)
    event = { ...event, data: { ...event.data, metadata: undefined } }
  }
  bus.emit(EVENT_NAME, event)
}

export function onAutomationEvent(handler: AutomationEventHandler): void {
  bus.on(EVENT_NAME, handler)
}

export function offAutomationEvent(handler: AutomationEventHandler): void {
  bus.off(EVENT_NAME, handler)
}
