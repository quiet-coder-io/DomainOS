/**
 * Minimal 5-field cron parser.
 * Fields: minute (0-59), hour (0-23), day of month (1-31), month (1-12), day of week (0-6, 0=Sunday).
 * Supports: *, numbers, commas, ranges (1-5), steps (*\/2).
 * No seconds, years, or macros. All evaluation in local timezone.
 */

interface CronField {
  values: Set<number>
}

const FIELD_DEFS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 6 },
] as const

function parseField(token: string, min: number, max: number): CronField | string {
  const values = new Set<number>()

  for (const part of token.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    let rangeToken = stepMatch ? stepMatch[1] : part
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1

    if (step < 1) return `invalid step value: ${step}`

    let rangeMin: number
    let rangeMax: number

    if (rangeToken === '*') {
      rangeMin = min
      rangeMax = max
    } else {
      const dashMatch = rangeToken.match(/^(\d+)-(\d+)$/)
      if (dashMatch) {
        rangeMin = parseInt(dashMatch[1], 10)
        rangeMax = parseInt(dashMatch[2], 10)
        if (rangeMin > rangeMax) return `invalid range: ${rangeMin}-${rangeMax}`
      } else {
        const num = parseInt(rangeToken, 10)
        if (isNaN(num)) return `invalid value: ${rangeToken}`
        rangeMin = num
        rangeMax = num
      }
    }

    if (rangeMin < min || rangeMax > max) {
      return `value out of range (${min}-${max}): ${part}`
    }

    for (let i = rangeMin; i <= rangeMax; i += step) {
      values.add(i)
    }
  }

  if (values.size === 0) return `no values resolved from: ${token}`
  return { values }
}

function parseExpression(expression: string): CronField[] | string {
  const tokens = expression.trim().split(/\s+/)
  if (tokens.length !== 5) return `expected 5 fields, got ${tokens.length}`

  const fields: CronField[] = []
  for (let i = 0; i < 5; i++) {
    const result = parseField(tokens[i], FIELD_DEFS[i].min, FIELD_DEFS[i].max)
    if (typeof result === 'string') return `${FIELD_DEFS[i].name}: ${result}`
    fields.push(result)
  }
  return fields
}

/**
 * Returns an error message if the cron expression is invalid, or null if valid.
 */
export function validateCron(expression: string): string | null {
  const result = parseExpression(expression)
  return typeof result === 'string' ? result : null
}

/**
 * Returns true if the given date matches the cron expression.
 */
export function matchesCron(expression: string, date: Date): boolean {
  const fields = parseExpression(expression)
  if (typeof fields === 'string') return false

  const minute = date.getMinutes()
  const hour = date.getHours()
  const dayOfMonth = date.getDate()
  const month = date.getMonth() + 1
  const dayOfWeek = date.getDay()

  return (
    fields[0].values.has(minute) &&
    fields[1].values.has(hour) &&
    fields[2].values.has(dayOfMonth) &&
    fields[3].values.has(month) &&
    fields[4].values.has(dayOfWeek)
  )
}

/**
 * Walk backwards from `before` (exclusive) up to 7 days looking for the last
 * minute that matches the cron expression. Returns null if none found.
 */
export function lastCronMatch(expression: string, before: Date): Date | null {
  const fields = parseExpression(expression)
  if (typeof fields === 'string') return null

  // Start from the minute before `before`, zeroing seconds/ms
  const cursor = new Date(before)
  cursor.setSeconds(0, 0)
  cursor.setTime(cursor.getTime() - 60_000) // go back 1 minute

  const limit = 7 * 24 * 60 // 7 days in minutes
  for (let i = 0; i < limit; i++) {
    const minute = cursor.getMinutes()
    const hour = cursor.getHours()
    const dayOfMonth = cursor.getDate()
    const month = cursor.getMonth() + 1
    const dayOfWeek = cursor.getDay()

    if (
      fields[0].values.has(minute) &&
      fields[1].values.has(hour) &&
      fields[2].values.has(dayOfMonth) &&
      fields[3].values.has(month) &&
      fields[4].values.has(dayOfWeek)
    ) {
      return cursor
    }

    cursor.setTime(cursor.getTime() - 60_000)
  }

  return null
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function formatTimeComponent(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const displayMinute = String(minute).padStart(2, '0')
  return `${displayHour}:${displayMinute} ${period}`
}

/**
 * Produces a human-readable description of a cron expression.
 * Best-effort — complex expressions get a generic description.
 */
export function describeHumanReadable(expression: string): string {
  const fields = parseExpression(expression)
  if (typeof fields === 'string') return `Invalid: ${fields}`

  const [minuteField, hourField, domField, monthField, dowField] = fields

  const allMinutes = minuteField.values.size === 60
  const allHours = hourField.values.size === 24
  const allDom = domField.values.size === 31
  const allMonths = monthField.values.size === 12
  const allDow = dowField.values.size === 7

  const minutes = [...minuteField.values].sort((a, b) => a - b)
  const hours = [...hourField.values].sort((a, b) => a - b)
  const dows = [...dowField.values].sort((a, b) => a - b)

  // Every minute
  if (allMinutes && allHours && allDom && allMonths && allDow) {
    return 'Every minute'
  }

  // Specific single time, all days
  if (minutes.length === 1 && hours.length === 1 && allDom && allMonths && allDow) {
    return `Every day at ${formatTimeComponent(hours[0], minutes[0])}`
  }

  // Specific single time, specific days of week
  if (minutes.length === 1 && hours.length === 1 && allDom && allMonths && !allDow) {
    const dayStr = dows.length === 5 && !dows.includes(0) && !dows.includes(6)
      ? 'weekday'
      : dows.map(d => DAY_NAMES[d]).join(', ')
    return `Every ${dayStr} at ${formatTimeComponent(hours[0], minutes[0])}`
  }

  // Specific single time on a specific day of month
  if (minutes.length === 1 && hours.length === 1 && domField.values.size === 1 && allMonths && allDow) {
    const dom = [...domField.values][0]
    return `On the ${ordinal(dom)} of every month at ${formatTimeComponent(hours[0], minutes[0])}`
  }

  // Every N minutes
  if (allHours && allDom && allMonths && allDow && minutes.length > 1) {
    const step = detectStep(minutes, 0, 59)
    if (step) return `Every ${step} minutes`
  }

  // Every N hours at specific minute
  if (allDom && allMonths && allDow && minutes.length === 1 && hours.length > 1) {
    const step = detectStep(hours, 0, 23)
    if (step) return `Every ${step} hours at minute ${minutes[0]}`
  }

  // Fallback: generic description
  return `Cron: ${expression}`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function detectStep(values: number[], min: number, max: number): number | null {
  if (values.length < 2) return null
  const step = values[1] - values[0]
  if (step < 1) return null
  // Verify all values match the step pattern
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== min + i * step) return null
  }
  // Verify the step covers the full range
  const expected = Math.floor((max - min) / step) + 1
  if (values.length !== expected) return null
  return step
}
