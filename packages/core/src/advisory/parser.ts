/**
 * Advisory fence block parser — strict JSON-only parsing for advisory artifacts.
 *
 * Key invariants:
 * - Only scans fences starting with ```advisory- (parser isolation)
 * - JSON-only content (no key-value lines)
 * - Zod .strict() validation for all schemas
 * - Multi-block support with persist-first ordering (cap 2)
 * - Control/payload split at parse time
 * - Fingerprint dedup + layered rate limiting
 * - Runs ONLY on final assistant message (not intermediate tool calls)
 */

import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  CURRENT_SCHEMA_VERSION,
  PAYLOAD_SCHEMAS,
  type AdvisoryType,
  type AdvisoryMode,
  type AdvisoryDraftBlock,
  type AdvisoryParseResult,
  type AdvisoryStatus,
} from './schemas.js'
import {
  normalizeEnum,
  normalizePersist,
  normalizeType,
  validateEnum,
  type AdvisoryRejectEntry,
  type AdvisoryWarningEntry,
} from './normalize.js'
import { AdvisoryRepository } from './repository.js'

// ── Constants ──

export const ADVISORY_MAX_PERSIST_PER_RESPONSE = 2
export const ADVISORY_MAX_DRAFT_CAPTURE_PER_MESSAGE = 2
const MAX_RAW_SIZE_BYTES = 32_768 // 32KB
const ADVISORY_TYPES: readonly AdvisoryType[] = ['brainstorm', 'risk_assessment', 'scenario', 'strategic_review']
const ADVISORY_MODES: readonly AdvisoryMode[] = ['brainstorm', 'challenge', 'review', 'scenario', 'general']
const CONTROL_FIELDS = new Set(['schemaVersion', 'type', 'persist', 'title'])

// ── Stable stringify for fingerprinting ──

export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return ''
  if (typeof obj !== 'object') return String(obj)
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']'
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
  return '{' + sorted.map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])).join(',') + '}'
}

function canonicalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// ── Fingerprint computation ──

export function computeFingerprint(
  schemaVersion: number,
  type: AdvisoryType,
  title: string,
  payload: Record<string, unknown>,
): string {
  const canonTitle = canonicalize(title)

  // Type-specific core payload extraction
  let canonicalCore: Record<string, unknown> = {}
  let rawCore: Record<string, unknown> = {}

  switch (type) {
    case 'brainstorm': {
      const topic = String(payload.topic ?? '')
      const optionTitles = (payload.options as Array<{ title?: string; label?: string }> ?? [])
        .map((o) => o.title ?? o.label ?? '')
      canonicalCore = { topic: canonicalize(topic), options: optionTitles.map(canonicalize) }
      rawCore = { topic, options: optionTitles }
      break
    }
    case 'risk_assessment': {
      const summary = String(payload.summary ?? '')
      const riskCategories = (payload.risks as Array<{ category?: string; label?: string }> ?? [])
        .map((r) => r.category ?? r.label ?? '')
      canonicalCore = { summary: canonicalize(summary), risks: riskCategories.map(canonicalize) }
      rawCore = { summary, risks: riskCategories }
      break
    }
    case 'scenario': {
      const variables = (payload.variables as string[] ?? [])
      const scenarioNames = (payload.scenarios as Array<{ name?: string; label?: string }> ?? [])
        .map((s) => s.name ?? s.label ?? '')
      canonicalCore = { variables: variables.map(canonicalize), scenarios: scenarioNames.map(canonicalize) }
      rawCore = { variables, scenarios: scenarioNames }
      break
    }
    case 'strategic_review': {
      const hla = String(payload.highest_leverage_action ?? '')
      const tensions = (payload.tensions as string[] ?? [])
      canonicalCore = { highest_leverage_action: canonicalize(hla), tensions: tensions.map(canonicalize) }
      rawCore = { highest_leverage_action: hla, tensions }
      break
    }
  }

  const input = `${schemaVersion}|${type}|${canonTitle}|${stableStringify(canonicalCore)}|${stableStringify(rawCore)}`
  return createHash('sha256').update(input).digest('hex')
}

// ── Mode classification ──

function classifyMode(text: string): AdvisoryMode {
  // Check for explicit HTML comment first
  const modeComment = text.match(/<!--\s*advisory_mode:\s*(\w+)\s*-->/)
  if (modeComment) {
    const normalized = normalizeEnum(modeComment[1])
    if ((ADVISORY_MODES as readonly string[]).includes(normalized)) {
      return normalized as AdvisoryMode
    }
  }
  return 'general'
}

// ── Main parser ──

export interface ParseAdvisoryBlocksOptions {
  db?: Database.Database
}

export function parseAdvisoryBlocks(
  text: string,
  domainId: string,
  sessionId?: string,
  messageId?: string,
  options?: ParseAdvisoryBlocksOptions,
): AdvisoryParseResult {
  const result: AdvisoryParseResult = {
    classifiedMode: classifyMode(text),
    draftBlocks: [],
    persisted: [],
    rejects: [],
    warnings: [],
    systemNotes: [],
  }

  if (!text) return result

  // ── Step 1: Extract all advisory fence blocks ──
  const fenceRegex = /^```(advisory-\w+)[^\n]*\n([\s\S]*?)^```/gm
  const candidates: Array<{
    fenceType: string
    rawBody: string
    index: number
  }> = []

  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(text)) !== null) {
    candidates.push({
      fenceType: match[1],
      rawBody: match[2],
      index: match.index,
    })
  }

  if (candidates.length === 0) return result

  // ── Step 2: Validate each candidate independently ──
  interface ValidatedBlock {
    fenceType: string
    rawJson: string
    normalizedControl: {
      schemaVersion: number
      type: string
      persist: string
      title: string
    }
    payload: Record<string, unknown>
    warnings: AdvisoryWarningEntry[]
    persistable: boolean
    index: number
  }

  const validBlocks: ValidatedBlock[] = []

  for (const candidate of candidates) {
    const sizeBytes = Buffer.byteLength(candidate.rawBody, 'utf8')

    // Extract fence suffix type
    const suffixMatch = candidate.fenceType.match(/^advisory-(\w+)$/)
    if (!suffixMatch) {
      result.rejects.push({
        reason: 'invalid_fence_type',
        detail: candidate.fenceType,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    const fenceSuffix = normalizeType(suffixMatch[1])

    // Validate fence suffix is a known advisory type
    if (!(ADVISORY_TYPES as readonly string[]).includes(fenceSuffix)) {
      result.rejects.push({
        reason: 'invalid_fence_type',
        detail: `unknown type: ${fenceSuffix}`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    // Raw size cap
    if (sizeBytes > MAX_RAW_SIZE_BYTES) {
      result.rejects.push({
        reason: 'raw_size_exceeded',
        detail: `${sizeBytes} bytes > ${MAX_RAW_SIZE_BYTES}`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    // Parse JSON
    const trimmed = candidate.rawBody.trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      result.rejects.push({
        reason: 'invalid_json',
        detail: 'JSON parse failed',
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    // Must be a single JSON object (not array, not primitive)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      result.rejects.push({
        reason: 'invalid_json',
        detail: 'top_level_not_object',
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    const obj = parsed as Record<string, unknown>
    const blockWarnings: AdvisoryWarningEntry[] = []

    // ── Control field extraction ──

    // schemaVersion
    const rawSchemaVersion = obj.schemaVersion
    if (rawSchemaVersion === undefined || rawSchemaVersion === null) {
      result.rejects.push({
        reason: 'missing_control_field',
        detail: 'schemaVersion',
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }
    if (typeof rawSchemaVersion !== 'number' || !Number.isInteger(rawSchemaVersion) || rawSchemaVersion < 1) {
      result.rejects.push({
        reason: 'invalid_schema_version',
        detail: `value=${String(rawSchemaVersion)}`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }
    if (rawSchemaVersion > CURRENT_SCHEMA_VERSION) {
      result.rejects.push({
        reason: 'unsupported_schema_version',
        detail: `version=${rawSchemaVersion} current=${CURRENT_SCHEMA_VERSION}`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    // type
    if (typeof obj.type !== 'string' || !obj.type) {
      result.rejects.push({
        reason: 'missing_control_field',
        detail: 'type',
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }
    const normalizedJsonType = normalizeType(obj.type)
    if (normalizedJsonType !== obj.type.trim()) {
      blockWarnings.push({
        warning: 'type_normalized',
        detail: `raw="${obj.type}" normalized="${normalizedJsonType}"`,
        fenceType: candidate.fenceType,
        domainId,
      })
    }

    // Type match enforcement: JSON type must match fence suffix
    if (normalizedJsonType !== fenceSuffix) {
      result.rejects.push({
        reason: 'type_mismatch',
        detail: `fence=${fenceSuffix} json=${normalizedJsonType}`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    // title
    if (typeof obj.title !== 'string') {
      result.rejects.push({
        reason: 'missing_control_field',
        detail: 'title',
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }
    const title = obj.title
    if (title.length < 4 || title.length > 120) {
      result.rejects.push({
        reason: 'invalid_title',
        detail: `length=${title.length}`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }
    if (/[\n\r\t<>]/.test(title)) {
      result.rejects.push({
        reason: 'invalid_title',
        detail: 'contains control characters or angle brackets',
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    // persist
    if (typeof obj.persist !== 'string') {
      result.rejects.push({
        reason: 'missing_control_field',
        detail: 'persist',
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }
    const normalizedPersist = normalizePersist(obj.persist)
    if (normalizedPersist === null) {
      result.rejects.push({
        reason: 'missing_control_field',
        detail: `persist value unrecognized: "${obj.persist}"`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }
    if (normalizedPersist !== obj.persist.trim().toLowerCase()) {
      blockWarnings.push({
        warning: 'field_normalized',
        detail: `field=persist raw="${obj.persist}" normalized="${normalizedPersist}"`,
        fenceType: candidate.fenceType,
        domainId,
      })
    }

    // ── Strip control fields, build payload ──
    const payload: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (!CONTROL_FIELDS.has(key)) {
        payload[key] = value
      }
    }

    // Payload size cap
    const payloadJson = JSON.stringify(payload)
    if (Buffer.byteLength(payloadJson, 'utf8') > MAX_RAW_SIZE_BYTES) {
      result.rejects.push({
        reason: 'payload_size_exceeded',
        detail: `${Buffer.byteLength(payloadJson, 'utf8')} bytes > ${MAX_RAW_SIZE_BYTES}`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    // ── Zod schema validation (type-dispatched) ──
    const payloadSchema = PAYLOAD_SCHEMAS[normalizedJsonType as AdvisoryType]
    if (!payloadSchema) {
      result.rejects.push({
        reason: 'invalid_fence_type',
        detail: `no schema for type: ${normalizedJsonType}`,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    const zodResult = payloadSchema.safeParse(payload)
    if (!zodResult.success) {
      const firstIssue = zodResult.error.issues[0]
      let reason: AdvisoryRejectEntry['reason'] = 'zod_validation_failed'
      let detail = firstIssue?.message ?? 'unknown validation error'

      if (firstIssue) {
        const path = firstIssue.path.join('.')
        if (firstIssue.code === 'unrecognized_keys') {
          reason = path ? 'unknown_key_nested' : 'unknown_key_top_level'
          detail = `keys: ${(firstIssue as unknown as { keys: string[] }).keys?.join(', ') ?? 'unknown'} at ${path || 'root'}`
        } else if (firstIssue.code === 'too_big') {
          reason = 'field_size_exceeded'
          detail = `${path} exceeded max`
        } else if (firstIssue.code === 'invalid_type' && firstIssue.received === 'undefined') {
          reason = 'missing_required_key'
          detail = path
        } else {
          detail = `${path}: ${firstIssue.message}`
        }
      }

      result.rejects.push({
        reason,
        detail,
        fenceType: candidate.fenceType,
        domainId,
        sizeBytes,
      })
      continue
    }

    // ── Optional enum soft-fail (trend, trendConfidence) ──
    const validatedPayload = zodResult.data as Record<string, unknown>
    if (normalizedJsonType === 'risk_assessment') {
      if (typeof validatedPayload.trend === 'string') {
        const trendResult = validateEnum(
          validatedPayload.trend,
          ['improving', 'stable', 'worsening'] as const,
          'trend',
          candidate.fenceType,
          domainId,
        )
        validatedPayload.trend = trendResult.value
        if (trendResult.warning) blockWarnings.push(trendResult.warning)
      }
      if (typeof validatedPayload.trendConfidence === 'string') {
        const tcResult = validateEnum(
          validatedPayload.trendConfidence,
          ['low', 'medium', 'high'] as const,
          'trendConfidence',
          candidate.fenceType,
          domainId,
        )
        validatedPayload.trendConfidence = tcResult.value
        if (tcResult.warning) blockWarnings.push(tcResult.warning)
      }
    }

    validBlocks.push({
      fenceType: candidate.fenceType,
      rawJson: trimmed,
      normalizedControl: {
        schemaVersion: rawSchemaVersion,
        type: normalizedJsonType,
        persist: normalizedPersist,
        title,
      },
      payload: validatedPayload,
      warnings: blockWarnings,
      persistable: normalizedPersist === 'yes' || normalizedPersist === 'archive',
      index: candidate.index,
    })
  }

  // ── Step 3: Selection — persistable first, then nonPersistable, cap 2 ──
  const persistable = validBlocks.filter((b) => b.persistable)
  const nonPersistable = validBlocks.filter((b) => !b.persistable)
  const allOrdered = [...persistable, ...nonPersistable]
  const selected = allOrdered.slice(0, ADVISORY_MAX_PERSIST_PER_RESPONSE)

  // Log skipped valid blocks
  for (let i = ADVISORY_MAX_PERSIST_PER_RESPONSE; i < allOrdered.length; i++) {
    const skipped = allOrdered[i]
    result.rejects.push({
      reason: 'response_block_cap_exceeded',
      detail: `block ${i}, persist=${skipped.normalizedControl.persist}, skipped`,
      fenceType: skipped.fenceType,
      domainId,
      sizeBytes: Buffer.byteLength(skipped.rawJson, 'utf8'),
    })
  }

  // ── Step 4: Process selected blocks ──
  const repo = options?.db ? new AdvisoryRepository(options.db) : null

  for (const block of selected) {
    result.warnings.push(...block.warnings)

    const { normalizedControl, payload } = block
    const payloadJson = JSON.stringify(payload)

    if (normalizedControl.persist === 'no') {
      // Draft block — capture for 1-click save
      if (result.draftBlocks.length < ADVISORY_MAX_DRAFT_CAPTURE_PER_MESSAGE) {
        if (Buffer.byteLength(block.rawJson, 'utf8') <= MAX_RAW_SIZE_BYTES) {
          result.draftBlocks.push({
            fenceType: block.fenceType,
            rawJson: block.rawJson,
            normalizedControl,
            payload,
            warnings: block.warnings.length > 0 ? block.warnings : undefined,
          })
        }
      }
      continue
    }

    // Persistable block — save to DB
    if (!repo) {
      result.systemNotes.push('[Advisory] Artifact not saved: database not available.')
      continue
    }

    const fingerprint = computeFingerprint(
      normalizedControl.schemaVersion,
      normalizedControl.type as AdvisoryType,
      normalizedControl.title,
      payload,
    )

    const status: AdvisoryStatus = normalizedControl.persist === 'archive' ? 'archived' : 'active'

    const createResult = repo.create({
      domainId,
      sessionId,
      type: normalizedControl.type as AdvisoryType,
      title: normalizedControl.title,
      schemaVersion: normalizedControl.schemaVersion,
      content: payloadJson,
      fingerprint,
      source: 'llm',
      sourceMessageId: messageId,
      status,
    })

    if (createResult.ok) {
      const artifact = createResult.value
      result.persisted.push({
        artifactId: artifact.id,
        type: artifact.type,
        status: artifact.status,
      })

      console.info(
        `[advisory-parser] persist: ok | type=${normalizedControl.type} | domain=${domainId} | status=${status} | bytes=${Buffer.byteLength(payloadJson, 'utf8')} | fingerprint=${fingerprint.slice(0, 8)}`,
      )

      if (status === 'archived') {
        result.systemNotes.push('[Advisory] Saved to Strategic History (archived).')
      }
    } else {
      const errMsg = createResult.error.message
      if (errMsg.includes('hourly save limit')) {
        result.rejects.push({
          reason: 'rate_limit_hour',
          detail: errMsg,
          fenceType: block.fenceType,
          domainId,
          sizeBytes: Buffer.byteLength(block.rawJson, 'utf8'),
        })
        result.systemNotes.push(errMsg)
      } else if (errMsg.includes('daily save limit')) {
        result.rejects.push({
          reason: 'rate_limit_day',
          detail: errMsg,
          fenceType: block.fenceType,
          domainId,
          sizeBytes: Buffer.byteLength(block.rawJson, 'utf8'),
        })
        result.systemNotes.push(errMsg)
      } else {
        result.rejects.push({
          reason: 'zod_validation_failed',
          detail: errMsg,
          fenceType: block.fenceType,
          domainId,
          sizeBytes: Buffer.byteLength(block.rawJson, 'utf8'),
        })
      }
    }
  }

  // Log rejects
  for (const reject of result.rejects) {
    console.warn(
      `[advisory-parser] reject: ${reject.reason} | detail=${reject.detail ?? ''} | type=${reject.fenceType} | domain=${domainId} | size=${reject.sizeBytes}`,
    )
  }

  return result
}
