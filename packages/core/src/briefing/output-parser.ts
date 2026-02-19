/**
 * Parses LLM briefing analysis output into structured blocks.
 *
 * Extracts briefing-alert, briefing-action, and briefing-monitor fence blocks
 * with multiline-tolerant key parsing and validation diagnostics.
 */

// ── Result types ──

export interface BriefingAlert {
  domain: string
  severity: string
  text: string
  evidence: string
}

export interface BriefingAction {
  domain: string
  priority: number
  deadline: string
  text: string
}

export interface BriefingMonitor {
  domain: string
  text: string
}

export interface ParseDiagnostics {
  skippedBlocks: number
  errors: string[]
}

export interface BriefingParseResult {
  alerts: BriefingAlert[]
  actions: BriefingAction[]
  monitors: BriefingMonitor[]
  diagnostics: ParseDiagnostics
}

// ── Known field names per block type ──

const ALERT_FIELDS = new Set(['domain', 'severity', 'text', 'evidence'])
const ACTION_FIELDS = new Set(['domain', 'priority', 'deadline', 'text'])
const MONITOR_FIELDS = new Set(['domain', 'text'])

const ALL_KNOWN_FIELDS = new Set([...ALERT_FIELDS, ...ACTION_FIELDS, ...MONITOR_FIELDS])

const VALID_SEVERITIES = new Set(['critical', 'warning', 'monitor'])

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const MAX_DIAGNOSTIC_ERRORS = 5

// ── Block extraction regex ──
// Tolerant: accepts briefing-alert, briefing_alert, Briefing-Alert, trailing spaces
const BLOCK_RE = /```\s*briefing[-_]?(alert|action|monitor)\s*\r?\n([\s\S]*?)\r?\n?\s*```[ \t]*/gi

// ── Field line detection ──
// Matches "key: value" or "key:value" at line start
const FIELD_LINE_RE = /^([a-z]+)\s*:\s*(.*)$/i

// Lenient: matches "key value" without colon (for missing-colon tolerance)
const FIELD_NO_COLON_RE = /^([a-z]+)\s+(.+)$/i

/**
 * Parse multiline block body into key-value fields.
 * Continuation lines (indented 2+ spaces or blank) append to current field.
 */
function parseBlockFields(
  body: string,
  diagnostics: ParseDiagnostics,
): Map<string, string> {
  const fields = new Map<string, string>()
  let currentKey: string | null = null

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine

    // Try "key: value" first
    const fieldMatch = line.match(FIELD_LINE_RE)
    if (fieldMatch) {
      const key = fieldMatch[1].toLowerCase()
      const value = fieldMatch[2].trim()
      if (ALL_KNOWN_FIELDS.has(key)) {
        currentKey = key
        fields.set(key, value)
        continue
      }
    }

    // Continuation: indented 2+ spaces or blank line
    if (currentKey !== null && (/^\s{2,}/.test(line) || line.trim() === '')) {
      const prev = fields.get(currentKey) ?? ''
      const trimmed = line.trim()
      if (trimmed) {
        fields.set(currentKey, prev ? `${prev} ${trimmed}` : trimmed)
      }
      continue
    }

    // Try missing-colon fallback: "key value" (no colon)
    if (line.trim()) {
      const noColonMatch = line.match(FIELD_NO_COLON_RE)
      if (noColonMatch && ALL_KNOWN_FIELDS.has(noColonMatch[1].toLowerCase())) {
        const key = noColonMatch[1].toLowerCase()
        const value = noColonMatch[2].trim()
        currentKey = key
        fields.set(key, value)
        if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
          diagnostics.errors.push(`Missing colon: "${line.trim().slice(0, 40)}"`)
        }
        continue
      }

      // Unrecognized non-blank line — add to diagnostics but treat as continuation
      // of current field if we have one
      if (currentKey !== null) {
        const prev = fields.get(currentKey) ?? ''
        const trimmed = line.trim()
        fields.set(currentKey, prev ? `${prev} ${trimmed}` : trimmed)
      }
      if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
        diagnostics.errors.push(`Unrecognized line: "${line.trim().slice(0, 40)}"`)
      }
    }
  }

  return fields
}

/**
 * Validate and extract an alert block.
 */
function validateAlert(
  fields: Map<string, string>,
  diagnostics: ParseDiagnostics,
): BriefingAlert | null {
  const domain = fields.get('domain')?.trim()
  const severity = fields.get('severity')?.toLowerCase().trim()
  const text = fields.get('text')?.trim()
  const evidence = fields.get('evidence')?.trim()

  if (!domain || !text) {
    if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
      diagnostics.errors.push('Alert missing required field: domain or text')
    }
    return null
  }
  if (!severity || !VALID_SEVERITIES.has(severity)) {
    if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
      diagnostics.errors.push(`Alert invalid severity: "${severity ?? '(missing)'}". Must be critical|warning|monitor`)
    }
    return null
  }
  if (!evidence) {
    if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
      diagnostics.errors.push('Alert missing required field: evidence')
    }
    return null
  }

  return { domain, severity, text, evidence }
}

/**
 * Validate and extract an action block.
 */
function validateAction(
  fields: Map<string, string>,
  diagnostics: ParseDiagnostics,
): BriefingAction | null {
  const domain = fields.get('domain')?.trim()
  const text = fields.get('text')?.trim()
  const priorityRaw = fields.get('priority')?.trim()

  if (!domain || !text) {
    if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
      diagnostics.errors.push('Action missing required field: domain or text')
    }
    return null
  }

  if (!priorityRaw) {
    if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
      diagnostics.errors.push('Action missing required field: priority')
    }
    return null
  }

  const priority = parseInt(priorityRaw, 10)
  if (isNaN(priority) || priority < 1 || priority > 7) {
    if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
      diagnostics.errors.push(`Action invalid priority: "${priorityRaw}". Must be integer 1-7`)
    }
    return null
  }

  // Deadline: optional, validate if present
  let deadline = fields.get('deadline')?.trim() ?? 'none'
  if (deadline && deadline !== 'none') {
    if (!ISO_DATE_RE.test(deadline)) {
      if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
        diagnostics.errors.push(`Action invalid deadline: "${deadline}". Expected YYYY-MM-DD`)
      }
      deadline = 'none'
    }
  }

  return { domain, priority, deadline, text }
}

/**
 * Validate and extract a monitor block.
 */
function validateMonitor(
  fields: Map<string, string>,
  diagnostics: ParseDiagnostics,
): BriefingMonitor | null {
  const domain = fields.get('domain')?.trim()
  const text = fields.get('text')?.trim()

  if (!domain || !text) {
    if (diagnostics.errors.length < MAX_DIAGNOSTIC_ERRORS) {
      diagnostics.errors.push('Monitor missing required field: domain or text')
    }
    return null
  }

  return { domain, text }
}

/**
 * Parse LLM briefing analysis text into structured alerts, actions, and monitors.
 */
export function parseBriefingAnalysis(text: string): BriefingParseResult {
  const alerts: BriefingAlert[] = []
  const actions: BriefingAction[] = []
  const monitors: BriefingMonitor[] = []
  const diagnostics: ParseDiagnostics = { skippedBlocks: 0, errors: [] }

  if (!text) return { alerts, actions, monitors, diagnostics }

  let match: RegExpExecArray | null
  // Reset regex state
  BLOCK_RE.lastIndex = 0

  while ((match = BLOCK_RE.exec(text)) !== null) {
    const blockType = match[1].toLowerCase() as 'alert' | 'action' | 'monitor'
    const body = match[2]

    const fields = parseBlockFields(body, diagnostics)

    switch (blockType) {
      case 'alert': {
        const alert = validateAlert(fields, diagnostics)
        if (alert) alerts.push(alert)
        else diagnostics.skippedBlocks++
        break
      }
      case 'action': {
        const action = validateAction(fields, diagnostics)
        if (action) actions.push(action)
        else diagnostics.skippedBlocks++
        break
      }
      case 'monitor': {
        const monitor = validateMonitor(fields, diagnostics)
        if (monitor) monitors.push(monitor)
        else diagnostics.skippedBlocks++
        break
      }
    }
  }

  return { alerts, actions, monitors, diagnostics }
}
