/**
 * SQLite database initialization with WAL mode and migrations.
 *
 * Uses createRequire to load better-sqlite3 at runtime, which prevents
 * bundlers (Vite/Rollup) from trying to inline the native addon.
 */

import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'
import { runMigrations } from './migrations.js'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3') as new (path: string) => Database.Database

export function openDatabase(path: string): Database.Database {
  const db = new BetterSqlite3(path)

  // Performance + safety pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  return db
}
