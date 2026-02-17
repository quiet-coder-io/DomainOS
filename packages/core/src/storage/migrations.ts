/**
 * Version-based SQLite migrations.
 */

import type Database from 'better-sqlite3'

interface Migration {
  version: number
  description: string
  up(db: Database.Database): void
}

/**
 * Runs SQL statements using the better-sqlite3 Database.exec() method.
 * Note: This is NOT child_process.exec — it's SQLite's native exec for DDL.
 */
function runSQL(db: Database.Database, sql: string): void {
  db.exec(sql)
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema — domains, kb_files, protocols, chat_messages',
    up(db) {
      runSQL(
        db,
        `
        CREATE TABLE IF NOT EXISTS domains (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          kb_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS kb_files (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          last_synced_at TEXT NOT NULL,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS protocols (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `,
      )
    },
  },
]

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists for checking current version
  runSQL(
    db,
    `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  )

  const currentVersion = db
    .prepare('SELECT MAX(version) as version FROM schema_version')
    .get() as { version: number | null } | undefined

  const applied = currentVersion?.version ?? 0

  for (const migration of migrations) {
    if (migration.version > applied) {
      db.transaction(() => {
        migration.up(db)
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          new Date().toISOString(),
        )
      })()
    }
  }
}
