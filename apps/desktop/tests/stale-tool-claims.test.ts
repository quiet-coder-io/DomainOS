import { describe, it, expect } from 'vitest'
import { detectStaleToolClaims } from '../src/main/ipc-handlers'

describe('detectStaleToolClaims', () => {
  // ── Positive matches (should detect stale claims) ──

  it('detects "I don\'t have access to email"', () => {
    const messages = [
      { role: 'user', content: 'Check my inbox' },
      { role: 'assistant', content: "I don't have access to your email. Please share the email content here." },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "I cannot search your Gmail"', () => {
    const messages = [
      { role: 'user', content: 'Search for the lease email' },
      { role: 'assistant', content: 'I cannot search your Gmail directly. Could you paste the relevant email?' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "unable to connect to Gmail"', () => {
    const messages = [
      { role: 'assistant', content: "I'm unable to connect to Gmail at the moment." },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "lack email access"', () => {
    const messages = [
      { role: 'assistant', content: 'I lack email access, so I cannot retrieve that correspondence.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "email is not available"', () => {
    const messages = [
      { role: 'assistant', content: 'Gmail is not available in this session.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "do not have a live connection"', () => {
    const messages = [
      { role: 'assistant', content: "I do not have a live connection to your email account." },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "copy-paste the email content"', () => {
    const messages = [
      { role: 'assistant', content: 'Could you copy-paste the email content so I can review it?' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "please share the email content here"', () => {
    const messages = [
      { role: 'assistant', content: 'Please share the email content here and I can help analyze it.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "paste the correspondence text"', () => {
    const messages = [
      { role: 'assistant', content: 'Please paste the correspondence text and I\'ll review it.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "without tool access"', () => {
    const messages = [
      { role: 'assistant', content: 'Without tool access, I can only work with what you share directly.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "tasks unavailable"', () => {
    const messages = [
      { role: 'assistant', content: 'Google Tasks is unavailable right now.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('detects "can\'t use your tools"', () => {
    const messages = [
      { role: 'assistant', content: "I can't use your tools to look that up." },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  // ── Negative matches (should NOT flag) ──

  it('ignores normal email discussion', () => {
    const messages = [
      { role: 'assistant', content: 'I found 3 emails from your attorney about the settlement.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(false)
  })

  it('ignores user messages even with claim-like text', () => {
    const messages = [
      { role: 'user', content: "I don't have access to email right now" },
    ]
    expect(detectStaleToolClaims(messages)).toBe(false)
  })

  it('ignores assistant discussing email as a concept', () => {
    const messages = [
      { role: 'assistant', content: 'The email from John discusses the timeline for the project.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(false)
  })

  it('ignores assistant messages about tools that work', () => {
    const messages = [
      { role: 'assistant', content: 'I used the gmail_search tool and found the following results.' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(false)
  })

  it('returns false for empty messages', () => {
    expect(detectStaleToolClaims([])).toBe(false)
  })

  it('returns false for user-only conversation', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Can you check my email?' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(false)
  })

  // ── Mixed histories ──

  it('detects stale claim even when later messages are clean', () => {
    const messages = [
      { role: 'user', content: 'Check my email' },
      { role: 'assistant', content: "I don't have access to your email. Please paste the email content here." },
      { role: 'user', content: 'OK here is the email text...' },
      { role: 'assistant', content: 'Thanks for sharing. Based on this email, I recommend...' },
      { role: 'user', content: 'Now search for the lease email' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(true)
  })

  it('does not flag when no assistant messages exist', () => {
    const messages = [
      { role: 'user', content: 'Check my email' },
    ]
    expect(detectStaleToolClaims(messages)).toBe(false)
  })
})
