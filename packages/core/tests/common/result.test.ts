import { describe, it, expect } from 'vitest'
import { Ok, Err, unwrap, isOk, isErr } from '../../src/common/index.js'

describe('Result', () => {
  it('Ok wraps a value', () => {
    const result = Ok(42)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(42)
  })

  it('Err wraps an error', () => {
    const result = Err(new Error('fail'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('fail')
  })

  it('unwrap returns value for Ok', () => {
    expect(unwrap(Ok('hello'))).toBe('hello')
  })

  it('unwrap throws for Err', () => {
    expect(() => unwrap(Err(new Error('boom')))).toThrow('boom')
  })

  it('unwrap throws with stringified error for non-Error', () => {
    expect(() => unwrap(Err('string error'))).toThrow('string error')
  })

  it('isOk narrows to Ok', () => {
    const result = Ok(10)
    expect(isOk(result)).toBe(true)
    expect(isErr(result)).toBe(false)
  })

  it('isErr narrows to Err', () => {
    const result = Err('fail')
    expect(isErr(result)).toBe(true)
    expect(isOk(result)).toBe(false)
  })
})
