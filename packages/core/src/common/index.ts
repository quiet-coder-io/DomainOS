/**
 * Common utilities — shared types, Result pattern, error handling.
 */

export { Ok, Err, unwrap, isOk, isErr } from './result.js'
export type { Result } from './result.js'

export { DomainOSError } from './errors.js'
export type { ErrorCode } from './errors.js'

export { UUIDSchema, TimestampSchema, FilePathSchema } from './schemas.js'
