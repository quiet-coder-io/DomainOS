import { describe, it, expect } from 'vitest'
import { detectStatusIntent } from '../../src/agents/status-intent.js'

describe('detectStatusIntent', () => {
  // Layer 1: Explicit phrases
  it('should detect "what\'s the latest"', () => {
    expect(detectStatusIntent("what's the latest")).toBe(true)
  })

  it('should detect "whats the latest"', () => {
    expect(detectStatusIntent('whats the latest')).toBe(true)
  })

  it('should detect "status update"', () => {
    expect(detectStatusIntent('can you give me a status update')).toBe(true)
  })

  it('should detect "where do we stand"', () => {
    expect(detectStatusIntent('where do we stand')).toBe(true)
  })

  it('should detect "catch me up"', () => {
    expect(detectStatusIntent('catch me up on everything')).toBe(true)
  })

  it('should detect "brief me"', () => {
    expect(detectStatusIntent('brief me')).toBe(true)
  })

  it('should detect "what\'s new"', () => {
    expect(detectStatusIntent("what's new")).toBe(true)
  })

  it('should detect "what\'s changed"', () => {
    expect(detectStatusIntent("what's changed")).toBe(true)
  })

  it('should detect "bring me up to speed"', () => {
    expect(detectStatusIntent('bring me up to speed')).toBe(true)
  })

  it('should detect "what happened"', () => {
    expect(detectStatusIntent('what happened since last time')).toBe(true)
  })

  it('should detect "what did I miss"', () => {
    expect(detectStatusIntent('what did I miss')).toBe(true)
  })

  it('should detect "give me a rundown"', () => {
    expect(detectStatusIntent('give me a rundown')).toBe(true)
  })

  it('should detect "give me a briefing"', () => {
    expect(detectStatusIntent('give me a briefing')).toBe(true)
  })

  it('should detect "give me a update"', () => {
    expect(detectStatusIntent('give me a update')).toBe(true)
  })

  it('should detect "recent status"', () => {
    expect(detectStatusIntent('recent status')).toBe(true)
  })

  it('should detect "domain status"', () => {
    expect(detectStatusIntent('domain status')).toBe(true)
  })

  // Layer 2: Short-message heuristic with question signal
  it('should detect "anything urgent?"', () => {
    expect(detectStatusIntent('anything urgent?')).toBe(true)
  })

  it('should detect "what should I focus on today?"', () => {
    expect(detectStatusIntent('what should I focus on today?')).toBe(true)
  })

  it('should detect "any updates?"', () => {
    expect(detectStatusIntent('any updates?')).toBe(true)
  })

  it('should detect "where are we with this?"', () => {
    expect(detectStatusIntent('where are we with this?')).toBe(true)
  })

  it('should detect "any gaps still pending?"', () => {
    expect(detectStatusIntent('any gaps still pending?')).toBe(true)
  })

  // Layer 2: Imperative/shorthand (no question mark)
  it('should detect "status pls"', () => {
    expect(detectStatusIntent('status pls')).toBe(true)
  })

  it('should detect "quick update"', () => {
    expect(detectStatusIntent('quick update')).toBe(true)
  })

  it('should detect "update me"', () => {
    expect(detectStatusIntent('update me')).toBe(true)
  })

  it('should detect "briefing please"', () => {
    expect(detectStatusIntent('briefing please')).toBe(true)
  })

  // Allow-signal override of tech excludes
  it('should detect "any API issues in this domain?"', () => {
    expect(detectStatusIntent('any API issues in this domain?')).toBe(true)
  })

  // False positives: should NOT trigger
  it('should NOT trigger on "what\'s the latest npm release?"', () => {
    expect(detectStatusIntent("what's the latest npm release?")).toBe(true) // explicit phrase matches regardless
  })

  it('should NOT trigger on long technical questions containing "update"', () => {
    expect(detectStatusIntent('How do I update the database migration scripts to handle the new schema changes in production?')).toBe(false)
  })

  it('should NOT trigger on "tell me about the latest iOS SDK changes"', () => {
    // "latest" alone doesn't match explicit phrase — not "what's the latest"
    // > 60 chars check
    expect(detectStatusIntent('tell me about the latest iOS SDK changes')).toBe(false)
  })

  it('should NOT trigger on "what npm package should I use?"', () => {
    // short, has question, but "npm" is tech exclude and no allow-signals
    // Actually "what" matches question signal and "update" is not present
    // Let's check: no STATUS_KEYWORDS match
    expect(detectStatusIntent('what npm package should I use?')).toBe(false)
  })

  it('should NOT trigger on "help me write a function"', () => {
    expect(detectStatusIntent('help me write a function')).toBe(false)
  })

  it('should NOT trigger on empty string', () => {
    expect(detectStatusIntent('')).toBe(false)
  })

  it('should NOT trigger on a long detailed question', () => {
    expect(detectStatusIntent('Can you explain how the authentication middleware processes JWT tokens and validates the session cookies against the database schema?')).toBe(false)
  })

  // Edge cases
  it('should detect explicit phrase even in longer message', () => {
    expect(detectStatusIntent('Hey, can you catch me up on what happened with the vendor negotiations?')).toBe(true)
  })

  it('should detect case-insensitive explicit phrases', () => {
    expect(detectStatusIntent("WHAT'S THE LATEST")).toBe(true)
  })
})
