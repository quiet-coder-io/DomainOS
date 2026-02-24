/**
 * Status intent detection — determines if a user message is a domain status query.
 * Two-layer heuristic: explicit phrases + short-message with status signals.
 */

// Layer 1: Explicit status phrases (always match regardless of length)
const EXPLICIT_PHRASES = /\b(what'?s the latest|status update|where do we stand|where are we|catch me up|brief me|what'?s new|what'?s changed|bring me up to speed|what happened|what did [iI] miss|give me a (?:rundown|briefing|update)|recent status|domain status)\b/i

// Layer 2: Short-message keywords (require short message + question/imperative signal)
const STATUS_KEYWORDS = /\b(urgent|today|next|still|progress|updates?|new|changed|pending|block|track|follow up|stand|focus|priority|overdue|deadlines?|gaps?|decisions?|action items|status|briefing|pls|please|rundown|issues?)\b/i

// Question/interrogative signal
const QUESTION_SIGNAL = /[?]|\b(what|any|how|where)\b/i

// Imperative/shorthand pattern (no preceding verb needed)
const IMPERATIVE_PATTERN = /\b(status|update|briefing|rundown)\b/i

// Narrow exclude list: platform/tech terms that are never domain status queries
const TECH_EXCLUDES = /\b(iOS|Android|npm|pip|changelog|release notes|SDK|firmware)\b/i

// Allow-signals: domain/project context indicators that override tech excludes
const ALLOW_SIGNALS = /\b(domain|project|this|we|our|tasks|deadlines|gaps|decisions|action items|focus|urgent)\b/i

export function detectStatusIntent(message: string): boolean {
  // Layer 1: Explicit phrases always match
  if (EXPLICIT_PHRASES.test(message)) {
    return true
  }

  // Layer 2: Short-message heuristic
  if (message.length > 60) {
    return false
  }

  // Must contain a status keyword
  if (!STATUS_KEYWORDS.test(message)) {
    return false
  }

  // Must have a question signal OR imperative pattern
  if (!QUESTION_SIGNAL.test(message) && !IMPERATIVE_PATTERN.test(message)) {
    return false
  }

  // False positive guard: tech excludes suppressed when allow-signals present
  if (TECH_EXCLUDES.test(message) && !ALLOW_SIGNALS.test(message)) {
    return false
  }

  return true
}
