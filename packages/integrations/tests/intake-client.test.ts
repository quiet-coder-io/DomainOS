import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IntakeClient } from '../src/common/intake-client.js'

describe('IntakeClient', () => {
  let client: IntakeClient

  beforeEach(() => {
    client = new IntakeClient('http://localhost:9876', 'test-token')
  })

  it('posts payload to intake endpoint', async () => {
    const mockResponse = { id: 'item-123' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    )

    const result = await client.post({
      title: 'Test Email',
      content: 'Body',
      sourceType: 'gmail',
      externalId: 'msg-abc',
      metadata: { from: 'test@example.com' },
    })

    expect(result.ok).toBe(true)
    expect(result.itemId).toBe('item-123')

    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(fetchCall[0]).toBe('http://localhost:9876/intake')
    expect(fetchCall[1]?.method).toBe('POST')
    expect(fetchCall[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    })

    const body = JSON.parse(fetchCall[1]?.body as string)
    expect(body.sourceType).toBe('gmail')
    expect(body.externalId).toBe('msg-abc')

    vi.unstubAllGlobals()
  })

  it('returns error on HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }),
    )

    const result = await client.post({
      title: 'Test',
      content: 'Content',
      sourceType: 'gtasks',
      externalId: 'task-1',
      metadata: {},
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')

    vi.unstubAllGlobals()
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const result = await client.post({
      title: 'Test',
      content: 'Content',
      sourceType: 'gmail',
      externalId: 'msg-1',
      metadata: {},
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('ECONNREFUSED')

    vi.unstubAllGlobals()
  })

  it('checks duplicate returns true when exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ exists: true }),
      }),
    )

    const exists = await client.checkDuplicate('gmail', 'msg-abc')
    expect(exists).toBe(true)

    vi.unstubAllGlobals()
  })

  it('checks duplicate returns false when not found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ exists: false }),
      }),
    )

    const exists = await client.checkDuplicate('gmail', 'msg-xyz')
    expect(exists).toBe(false)

    vi.unstubAllGlobals()
  })

  it('checks duplicate returns false on error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const exists = await client.checkDuplicate('gmail', 'msg-abc')
    expect(exists).toBe(false)

    vi.unstubAllGlobals()
  })
})
