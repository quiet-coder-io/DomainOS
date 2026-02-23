/**
 * Centralized normalization utilities for advisory and decision parsers.
 * Single source of truth — prevents drift between parsers.
 */

// ── Telemetry types ──

export type AdvisoryRejectReason =
  | 'invalid_fence_type'
  | 'invalid_json'
  | 'missing_control_field'
  | 'invalid_schema_version'
  | 'unsupported_schema_version'
  | 'type_mismatch'
  | 'invalid_title'
  | 'raw_size_exceeded'
  | 'payload_size_exceeded'
  | 'field_size_exceeded'
  | 'unknown_key_top_level'
  | 'unknown_key_nested'
  | 'missing_required_key'
  | 'zod_validation_failed'
  | 'rate_limit_hour'
  | 'rate_limit_day'
  | 'response_block_cap_exceeded'
  | 'duplicate_fingerprint_conflict'

export interface AdvisoryRejectEntry {
  reason: AdvisoryRejectReason
  detail?: string
  fenceType: string
  domainId: string
  sizeBytes: number
}

export type AdvisoryWarningReason =
  | 'invalid_enum_value'
  | 'field_normalized'
  | 'type_normalized'

export interface AdvisoryWarningEntry {
  warning: AdvisoryWarningReason
  detail: string
  fenceType: string
  domainId: string
}

// ── Normalization functions ──

/**
 * Base enum normalizer: trim, lowercase, replace hyphens/spaces with underscores.
 */
export function normalizeEnum(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * Normalize persist value with alias mapping.
 * Returns null for unrecognized values (→ reject block).
 */
export function normalizePersist(raw: string): 'yes' | 'no' | 'archive' | null {
  const normalized = normalizeEnum(raw)
  const aliases: Record<string, 'yes' | 'no' | 'archive'> = {
    yes: 'yes',
    y: 'yes',
    true: 'yes',
    archive: 'archive',
    archived: 'archive',
    no: 'no',
    false: 'no',
    n: 'no',
  }
  return aliases[normalized] ?? null
}

/**
 * Normalize advisory type with alias mapping.
 * Returns the normalized string (caller must validate against allowed set).
 */
export function normalizeType(raw: string): string {
  const normalized = normalizeEnum(raw)
  const aliases: Record<string, string> = {
    'risk_assessment': 'risk_assessment',
    'riskassessment': 'risk_assessment',
    'strategic_review': 'strategic_review',
    'strategicreview': 'strategic_review',
  }
  return aliases[normalized] ?? normalized
}

/**
 * Validate an enum value against an allowed set.
 * Normalizes first, then checks membership.
 * Returns value if valid, null + warning if invalid.
 */
export function validateEnum<T extends string>(
  raw: string,
  allowed: readonly T[],
  fieldName: string,
  fenceType: string,
  domainId: string,
): { value: T | null; warning?: AdvisoryWarningEntry } {
  const normalized = normalizeEnum(raw)
  if ((allowed as readonly string[]).includes(normalized)) {
    if (normalized !== raw.trim()) {
      return {
        value: normalized as T,
        warning: {
          warning: 'field_normalized',
          detail: `field=${fieldName} raw="${raw}" normalized="${normalized}"`,
          fenceType,
          domainId,
        },
      }
    }
    return { value: normalized as T }
  }
  return {
    value: null,
    warning: {
      warning: 'invalid_enum_value',
      detail: `field=${fieldName} raw="${raw}" normalized="${normalized}"`,
      fenceType,
      domainId,
    },
  }
}
