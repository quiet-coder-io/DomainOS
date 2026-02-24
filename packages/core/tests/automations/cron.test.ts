import { describe, it, expect } from 'vitest'
import { matchesCron, validateCron, lastCronMatch, describeHumanReadable } from '../../src/automations/cron.js'

describe('matchesCron', () => {
  it('matches any date with * * * * *', () => {
    expect(matchesCron('* * * * *', new Date('2025-06-15T10:30:00'))).toBe(true)
    expect(matchesCron('* * * * *', new Date('2025-01-01T00:00:00'))).toBe(true)
    expect(matchesCron('* * * * *', new Date('2025-12-31T23:59:00'))).toBe(true)
  })

  it('matches Monday 9:00 AM only with 0 9 * * 1', () => {
    // Monday June 16, 2025 at 09:00
    const monday9am = new Date(2025, 5, 16, 9, 0)
    expect(monday9am.getDay()).toBe(1) // confirm Monday
    expect(matchesCron('0 9 * * 1', monday9am)).toBe(true)

    // Monday at 10:00 — should not match
    const monday10am = new Date(2025, 5, 16, 10, 0)
    expect(matchesCron('0 9 * * 1', monday10am)).toBe(false)

    // Tuesday at 09:00 — should not match
    const tuesday9am = new Date(2025, 5, 17, 9, 0)
    expect(tuesday9am.getDay()).toBe(2)
    expect(matchesCron('0 9 * * 1', tuesday9am)).toBe(false)
  })

  it('matches every 5 minutes with */5 * * * *', () => {
    const at0 = new Date(2025, 5, 15, 10, 0)
    const at5 = new Date(2025, 5, 15, 10, 5)
    const at10 = new Date(2025, 5, 15, 10, 10)
    const at3 = new Date(2025, 5, 15, 10, 3)

    expect(matchesCron('*/5 * * * *', at0)).toBe(true)
    expect(matchesCron('*/5 * * * *', at5)).toBe(true)
    expect(matchesCron('*/5 * * * *', at10)).toBe(true)
    expect(matchesCron('*/5 * * * *', at3)).toBe(false)
  })

  it('matches 1st of month at midnight with 0 0 1 * *', () => {
    const firstMidnight = new Date(2025, 5, 1, 0, 0)
    expect(matchesCron('0 0 1 * *', firstMidnight)).toBe(true)

    // 2nd of month at midnight
    const secondMidnight = new Date(2025, 5, 2, 0, 0)
    expect(matchesCron('0 0 1 * *', secondMidnight)).toBe(false)

    // 1st of month at 1:00 AM
    const first1am = new Date(2025, 5, 1, 1, 0)
    expect(matchesCron('0 0 1 * *', first1am)).toBe(false)
  })

  it('supports day-of-week ranges: 1-5 (Mon-Fri)', () => {
    // Monday through Friday at noon
    const monday = new Date(2025, 5, 16, 12, 0)   // Monday
    const wednesday = new Date(2025, 5, 18, 12, 0) // Wednesday
    const friday = new Date(2025, 5, 20, 12, 0)    // Friday
    const saturday = new Date(2025, 5, 21, 12, 0)  // Saturday
    const sunday = new Date(2025, 5, 15, 12, 0)    // Sunday

    expect(matchesCron('0 12 * * 1-5', monday)).toBe(true)
    expect(matchesCron('0 12 * * 1-5', wednesday)).toBe(true)
    expect(matchesCron('0 12 * * 1-5', friday)).toBe(true)
    expect(matchesCron('0 12 * * 1-5', saturday)).toBe(false)
    expect(matchesCron('0 12 * * 1-5', sunday)).toBe(false)
  })

  it('supports comma-separated values: 1,15 * * * *', () => {
    const atMin1 = new Date(2025, 5, 15, 10, 1)
    const atMin15 = new Date(2025, 5, 15, 10, 15)
    const atMin7 = new Date(2025, 5, 15, 10, 7)

    expect(matchesCron('1,15 * * * *', atMin1)).toBe(true)
    expect(matchesCron('1,15 * * * *', atMin15)).toBe(true)
    expect(matchesCron('1,15 * * * *', atMin7)).toBe(false)
  })

  it('supports step over range: 0-30/10 * * * *', () => {
    // Should match minutes 0, 10, 20, 30
    expect(matchesCron('0-30/10 * * * *', new Date(2025, 0, 1, 0, 0))).toBe(true)
    expect(matchesCron('0-30/10 * * * *', new Date(2025, 0, 1, 0, 10))).toBe(true)
    expect(matchesCron('0-30/10 * * * *', new Date(2025, 0, 1, 0, 20))).toBe(true)
    expect(matchesCron('0-30/10 * * * *', new Date(2025, 0, 1, 0, 30))).toBe(true)
    expect(matchesCron('0-30/10 * * * *', new Date(2025, 0, 1, 0, 40))).toBe(false)
    expect(matchesCron('0-30/10 * * * *', new Date(2025, 0, 1, 0, 5))).toBe(false)
  })

  it('returns false for invalid expression', () => {
    expect(matchesCron('bad', new Date())).toBe(false)
    expect(matchesCron('* * *', new Date())).toBe(false)
  })

  it('supports specific month: 0 0 * 6 *', () => {
    const juneDate = new Date(2025, 5, 1, 0, 0) // month index 5 = June = cron month 6
    const julyDate = new Date(2025, 6, 1, 0, 0)
    expect(matchesCron('0 0 * 6 *', juneDate)).toBe(true)
    expect(matchesCron('0 0 * 6 *', julyDate)).toBe(false)
  })

  it('handles Sunday as day 0', () => {
    const sunday = new Date(2025, 5, 15, 9, 0)
    expect(sunday.getDay()).toBe(0)
    expect(matchesCron('0 9 * * 0', sunday)).toBe(true)
  })
})

describe('validateCron', () => {
  it('returns null for valid expressions', () => {
    expect(validateCron('* * * * *')).toBeNull()
    expect(validateCron('0 9 * * 1')).toBeNull()
    expect(validateCron('*/5 * * * *')).toBeNull()
    expect(validateCron('0 0 1 * *')).toBeNull()
    expect(validateCron('1,15 * * * *')).toBeNull()
    expect(validateCron('0 12 * * 1-5')).toBeNull()
  })

  it('returns error string for invalid expressions', () => {
    // Wrong field count
    const tooFew = validateCron('* * *')
    expect(tooFew).toBeTypeOf('string')
    expect(tooFew).toContain('expected 5 fields')

    // Out of range
    const outOfRange = validateCron('60 * * * *')
    expect(outOfRange).toBeTypeOf('string')

    // Invalid token
    const badToken = validateCron('abc * * * *')
    expect(badToken).toBeTypeOf('string')

    // Invalid range (min > max)
    const badRange = validateCron('5-2 * * * *')
    expect(badRange).toBeTypeOf('string')
  })

  it('rejects day-of-week value 7', () => {
    const result = validateCron('* * * * 7')
    expect(result).toBeTypeOf('string')
  })

  it('rejects hour value 24', () => {
    const result = validateCron('0 24 * * *')
    expect(result).toBeTypeOf('string')
  })

  it('rejects day-of-month value 0', () => {
    const result = validateCron('0 0 0 * *')
    expect(result).toBeTypeOf('string')
  })

  it('rejects month value 0', () => {
    const result = validateCron('0 0 * 0 *')
    expect(result).toBeTypeOf('string')
  })

  it('rejects month value 13', () => {
    const result = validateCron('0 0 * 13 *')
    expect(result).toBeTypeOf('string')
  })
})

describe('lastCronMatch', () => {
  it('finds most recent matching date', () => {
    const before = new Date(2025, 5, 16, 10, 0) // Monday June 16, 10:00
    // Looking for Monday 9:00 AM — should find June 16 at 9:00
    const result = lastCronMatch('0 9 * * 1', before)
    expect(result).not.toBeNull()
    expect(result!.getHours()).toBe(9)
    expect(result!.getMinutes()).toBe(0)
    expect(result!.getDay()).toBe(1) // Monday
  })

  it('returns the minute before "before" when using * * * * *', () => {
    const before = new Date(2025, 5, 15, 10, 30, 0, 0)
    const result = lastCronMatch('* * * * *', before)
    expect(result).not.toBeNull()
    expect(result!.getMinutes()).toBe(29)
    expect(result!.getHours()).toBe(10)
  })

  it('returns null for invalid expression', () => {
    expect(lastCronMatch('bad expression', new Date())).toBeNull()
  })

  it('returns null if no match within 7 days', () => {
    // A cron that only matches Feb 29 — unlikely to be within 7 days
    const before = new Date(2025, 2, 10, 0, 0) // March 10
    const result = lastCronMatch('0 0 29 2 *', before)
    expect(result).toBeNull()
  })

  it('finds match for every-5-minutes cron', () => {
    const before = new Date(2025, 5, 15, 10, 13) // 10:13
    const result = lastCronMatch('*/5 * * * *', before)
    expect(result).not.toBeNull()
    expect(result!.getMinutes()).toBe(10)
    expect(result!.getHours()).toBe(10)
  })

  it('zeroes seconds and milliseconds on result', () => {
    const before = new Date(2025, 5, 15, 10, 30, 45, 123)
    const result = lastCronMatch('* * * * *', before)
    expect(result).not.toBeNull()
    expect(result!.getSeconds()).toBe(0)
    expect(result!.getMilliseconds()).toBe(0)
  })
})

describe('describeHumanReadable', () => {
  it('describes every minute', () => {
    expect(describeHumanReadable('* * * * *')).toBe('Every minute')
  })

  it('describes daily at specific time', () => {
    const result = describeHumanReadable('0 9 * * *')
    expect(result).toBe('Every day at 9:00 AM')
  })

  it('describes daily at midnight', () => {
    const result = describeHumanReadable('0 0 * * *')
    expect(result).toBe('Every day at 12:00 AM')
  })

  it('describes daily at noon', () => {
    const result = describeHumanReadable('0 12 * * *')
    expect(result).toBe('Every day at 12:00 PM')
  })

  it('describes weekday schedule', () => {
    const result = describeHumanReadable('0 9 * * 1-5')
    expect(result).toBe('Every weekday at 9:00 AM')
  })

  it('describes specific days of week', () => {
    const result = describeHumanReadable('0 9 * * 1,3')
    expect(result).toContain('Monday')
    expect(result).toContain('Wednesday')
    expect(result).toContain('9:00 AM')
  })

  it('describes monthly schedule', () => {
    const result = describeHumanReadable('0 9 1 * *')
    expect(result).toContain('1st')
    expect(result).toContain('every month')
    expect(result).toContain('9:00 AM')
  })

  it('describes every N minutes', () => {
    const result = describeHumanReadable('*/5 * * * *')
    expect(result).toBe('Every 5 minutes')
  })

  it('describes every N hours', () => {
    const result = describeHumanReadable('0 */2 * * *')
    expect(result).toBe('Every 2 hours at minute 0')
  })

  it('falls back to raw expression for complex patterns', () => {
    const result = describeHumanReadable('1,15 9,17 * * *')
    expect(result).toContain('Cron:')
  })

  it('returns error for invalid expression', () => {
    const result = describeHumanReadable('bad')
    expect(result).toContain('Invalid')
  })

  it('describes PM times correctly', () => {
    const result = describeHumanReadable('30 14 * * *')
    expect(result).toBe('Every day at 2:30 PM')
  })
})
