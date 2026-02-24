import { describe, it, expect } from 'vitest'
import {
  stableStringify,
  stableHash,
  materializeDedupePayload,
  generateDedupeKey,
} from '../../src/automations/dedupe.js'

describe('stableStringify', () => {
  it('produces identical output for differently-ordered keys', () => {
    const a = stableStringify({ b: 1, a: 2 })
    const b = stableStringify({ a: 2, b: 1 })
    expect(a).toBe(b)
  })

  it('handles nested objects with stable key ordering', () => {
    const a = stableStringify({ z: { b: 1, a: 2 }, y: 3 })
    const b = stableStringify({ y: 3, z: { a: 2, b: 1 } })
    expect(a).toBe(b)
  })

  it('handles arrays preserving order', () => {
    const result = stableStringify([3, 1, 2])
    expect(result).toBe('[3,1,2]')
  })

  it('handles arrays of objects', () => {
    const result = stableStringify([{ b: 1, a: 2 }, { d: 3, c: 4 }])
    expect(result).toBe('[{"a":2,"b":1},{"c":4,"d":3}]')
  })

  it('handles null', () => {
    expect(stableStringify(null)).toBe('null')
  })

  it('handles undefined', () => {
    expect(stableStringify(undefined)).toBe('null')
  })

  it('handles strings', () => {
    expect(stableStringify('hello')).toBe('"hello"')
  })

  it('handles numbers', () => {
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify(3.14)).toBe('3.14')
  })

  it('handles booleans', () => {
    expect(stableStringify(true)).toBe('true')
    expect(stableStringify(false)).toBe('false')
  })

  it('handles empty object', () => {
    expect(stableStringify({})).toBe('{}')
  })

  it('handles empty array', () => {
    expect(stableStringify([])).toBe('[]')
  })

  it('converts non-serializable types to null', () => {
    expect(stableStringify(() => {})).toBe('null')
    expect(stableStringify(Symbol('test'))).toBe('null')
  })

  it('handles deeply nested structures', () => {
    const obj = { a: { b: { c: { d: 'deep' } } } }
    const result = stableStringify(obj)
    expect(result).toBe('{"a":{"b":{"c":{"d":"deep"}}}}')
  })
})

describe('stableHash', () => {
  it('produces consistent SHA-256 for equivalent objects', () => {
    const hash1 = stableHash({ b: 1, a: 2 })
    const hash2 = stableHash({ a: 2, b: 1 })
    expect(hash1).toBe(hash2)
  })

  it('produces different hashes for different objects', () => {
    const hash1 = stableHash({ a: 1 })
    const hash2 = stableHash({ a: 2 })
    expect(hash1).not.toBe(hash2)
  })

  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = stableHash({ test: true })
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic across calls', () => {
    const obj = { key: 'value', nested: { num: 42 } }
    const hash1 = stableHash(obj)
    const hash2 = stableHash(obj)
    expect(hash1).toBe(hash2)
  })
})

describe('generateDedupeKey', () => {
  it('generates schedule key: {automationId}|{minuteKey}', () => {
    const key = generateDedupeKey('auto-1', 'schedule', { minuteKey: '2025-06-15T10:00' })
    expect(key).toBe('auto-1|2025-06-15T10:00')
  })

  it('generates event key: {automationId}|{eventType}|{payloadHash}|{minuteKey}', () => {
    const key = generateDedupeKey('auto-2', 'event', {
      minuteKey: '2025-06-15T10:00',
      eventType: 'intake_created',
      eventData: { entityId: 'e1', entityType: 'intake' },
    })
    expect(key).toMatch(/^auto-2\|intake_created\|[0-9a-f]{64}\|2025-06-15T10:00$/)
  })

  it('generates manual key: {automationId}|manual|{requestId}', () => {
    const key = generateDedupeKey('auto-3', 'manual', {
      minuteKey: '2025-06-15T10:00',
      requestId: 'req-abc',
    })
    expect(key).toBe('auto-3|manual|req-abc')
  })

  it('generates manual key with "none" when requestId missing', () => {
    const key = generateDedupeKey('auto-3', 'manual', { minuteKey: '2025-06-15T10:00' })
    expect(key).toBe('auto-3|manual|none')
  })

  it('generates same event key for equivalent payloads with different key ordering', () => {
    const key1 = generateDedupeKey('auto-2', 'event', {
      minuteKey: '2025-06-15T10:00',
      eventType: 'intake_created',
      eventData: { entityId: 'e1', entityType: 'intake' },
    })
    const key2 = generateDedupeKey('auto-2', 'event', {
      minuteKey: '2025-06-15T10:00',
      eventType: 'intake_created',
      eventData: { entityType: 'intake', entityId: 'e1' },
    })
    expect(key1).toBe(key2)
  })

  it('generates different event keys for different payloads', () => {
    const key1 = generateDedupeKey('auto-2', 'event', {
      minuteKey: '2025-06-15T10:00',
      eventType: 'intake_created',
      eventData: { entityId: 'e1', entityType: 'intake' },
    })
    const key2 = generateDedupeKey('auto-2', 'event', {
      minuteKey: '2025-06-15T10:00',
      eventType: 'intake_created',
      eventData: { entityId: 'e2', entityType: 'intake' },
    })
    expect(key1).not.toBe(key2)
  })

  it('uses "unknown" event type when not provided', () => {
    const key = generateDedupeKey('auto-2', 'event', {
      minuteKey: '2025-06-15T10:00',
      eventData: { entityId: 'e1' },
    })
    expect(key).toContain('|unknown|')
  })

  it('falls back to generic format for unknown trigger types', () => {
    const key = generateDedupeKey('auto-1', 'webhook', { minuteKey: '2025-06-15T10:00' })
    expect(key).toBe('auto-1|webhook|2025-06-15T10:00')
  })
})

describe('materializeDedupePayload', () => {
  it('extracts intake_created fields', () => {
    const result = materializeDedupePayload('intake_created', {
      entityId: 'e1',
      entityType: 'intake',
      extraField: 'ignored',
    })
    expect(result).toEqual({ entityId: 'e1', entityType: 'intake' })
    expect(result).not.toHaveProperty('extraField')
  })

  it('extracts kb_changed fields and sorts changedPaths', () => {
    const result = materializeDedupePayload('kb_changed', {
      entityId: 'e1',
      entityType: 'domain',
      changedPaths: ['z.md', 'a.md', 'm.md'],
    })
    expect(result).toEqual({
      entityId: 'e1',
      entityType: 'domain',
      changedPaths: ['a.md', 'm.md', 'z.md'],
    })
  })

  it('handles kb_changed with non-array changedPaths', () => {
    const result = materializeDedupePayload('kb_changed', {
      entityId: 'e1',
      entityType: 'domain',
      changedPaths: 'not-an-array',
    })
    expect(result.changedPaths).toEqual([])
  })

  it('extracts gap_flag_raised fields', () => {
    const result = materializeDedupePayload('gap_flag_raised', {
      entityId: 'e1',
      entityType: 'domain',
      severity: 'high',
      other: 'ignored',
    })
    expect(result).toEqual({ entityId: 'e1', entityType: 'domain', severity: 'high' })
  })

  it('extracts deadline_approaching fields', () => {
    const result = materializeDedupePayload('deadline_approaching', {
      deadlineId: 'd1',
      entityId: 'e1',
      dueDate: '2025-06-15',
    })
    expect(result).toEqual({
      entityId: 'd1',
      entityType: 'deadline',
      dueDate: '2025-06-15',
    })
  })

  it('uses entityId fallback when deadlineId missing for deadline_approaching', () => {
    const result = materializeDedupePayload('deadline_approaching', {
      entityId: 'e1',
      dueDate: '2025-06-15',
    })
    expect(result.entityId).toBe('e1')
  })

  it('passes through eventData for unknown event types', () => {
    const data = { foo: 'bar', num: 42 }
    const result = materializeDedupePayload('unknown_event', data)
    expect(result).toEqual(data)
  })
})
