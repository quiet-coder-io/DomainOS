/**
 * Shared Zod schemas used across modules.
 */

import { z } from 'zod'

export const UUIDSchema = z.string().uuid()

export const TimestampSchema = z.string().datetime()

export const FilePathSchema = z.string().min(1, 'File path cannot be empty')
