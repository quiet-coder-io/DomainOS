import { randomBytes, timingSafeEqual } from 'node:crypto'

let currentToken: string | null = null

export function generateIntakeToken(): string {
  currentToken = randomBytes(32).toString('hex')
  return currentToken
}

export function getIntakeToken(): string {
  if (!currentToken) {
    return generateIntakeToken()
  }
  return currentToken
}

export function validateIntakeToken(token: string): boolean {
  if (!currentToken) return false
  try {
    const a = Buffer.from(token, 'utf-8')
    const b = Buffer.from(currentToken, 'utf-8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
