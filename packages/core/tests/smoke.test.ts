import { describe, it, expect } from 'vitest'

describe('@domain-os/core', () => {
  it('can be imported without errors', async () => {
    const core = await import('../src/index.js')
    expect(core).toBeDefined()
  })
})
