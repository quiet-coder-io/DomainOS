import { app } from 'electron'
import { join } from 'node:path'
import { openDatabase } from '@domain-os/core'
import type Database from 'better-sqlite3'

let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  const dbPath = join(app.getPath('userData'), 'domain-os.db')
  db = openDatabase(dbPath)
  return db
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
