/**
 * Typed error class for DomainOS operations.
 */

export type ErrorCode =
  | 'DB_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'IO_ERROR'
  | 'LLM_ERROR'
  | 'PARSE_ERROR'

export class DomainOSError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'DomainOSError'
    this.code = code
  }

  static notFound(entity: string, id: string): DomainOSError {
    return new DomainOSError('NOT_FOUND', `${entity} not found: ${id}`)
  }

  static validation(message: string): DomainOSError {
    return new DomainOSError('VALIDATION_ERROR', message)
  }

  static db(message: string): DomainOSError {
    return new DomainOSError('DB_ERROR', message)
  }

  static io(message: string): DomainOSError {
    return new DomainOSError('IO_ERROR', message)
  }

  static llm(message: string): DomainOSError {
    return new DomainOSError('LLM_ERROR', message)
  }

  static parse(message: string): DomainOSError {
    return new DomainOSError('PARSE_ERROR', message)
  }
}
