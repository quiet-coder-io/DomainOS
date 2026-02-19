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
  {
    version: 2,
    description: 'Intake items — browser ingestion pipeline',
    up(db) {
      runSQL(
        db,
        `
        CREATE TABLE IF NOT EXISTS intake_items (
          id TEXT PRIMARY KEY,
          source_url TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          extraction_mode TEXT NOT NULL DEFAULT 'full',
          content_size_bytes INTEGER NOT NULL,
          suggested_domain_id TEXT,
          confidence REAL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          FOREIGN KEY (suggested_domain_id) REFERENCES domains(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_intake_items_status ON intake_items(status);
      `,
      )
    },
  },
  {
    version: 3,
    description: 'KB tiers, agent identity, shared protocols, audit log, decisions',
    up(db) {
      runSQL(
        db,
        `
        -- KB tiers
        ALTER TABLE kb_files ADD COLUMN tier TEXT NOT NULL DEFAULT 'general';
        ALTER TABLE kb_files ADD COLUMN tier_source TEXT NOT NULL DEFAULT 'inferred';

        -- Agent identity + escalation
        ALTER TABLE domains ADD COLUMN identity TEXT NOT NULL DEFAULT '';
        ALTER TABLE domains ADD COLUMN escalation_triggers TEXT NOT NULL DEFAULT '';

        -- Shared protocols
        CREATE TABLE IF NOT EXISTS shared_protocols (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          priority INTEGER NOT NULL DEFAULT 0,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          scope TEXT NOT NULL DEFAULT 'all',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(scope IN ('all','chat','startup'))
        );

        -- Audit log
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          session_id TEXT,
          agent_name TEXT NOT NULL DEFAULT '',
          file_path TEXT NOT NULL DEFAULT '',
          change_description TEXT NOT NULL,
          content_hash TEXT NOT NULL DEFAULT '',
          event_type TEXT NOT NULL DEFAULT 'kb_write',
          source TEXT NOT NULL DEFAULT 'agent',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
          CHECK(event_type IN ('kb_write','cross_domain_read','decision_created','session_start','session_wrap'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_domain ON audit_log(domain_id, created_at);

        -- Decisions
        CREATE TABLE IF NOT EXISTS decisions (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          session_id TEXT,
          decision_id TEXT NOT NULL,
          decision TEXT NOT NULL,
          rationale TEXT NOT NULL DEFAULT '',
          downside TEXT NOT NULL DEFAULT '',
          revisit_trigger TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          supersedes_decision_id TEXT,
          linked_files TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
          FOREIGN KEY (supersedes_decision_id) REFERENCES decisions(id) ON DELETE SET NULL,
          CHECK(status IN ('active','superseded','rejected')),
          CHECK(supersedes_decision_id IS NULL OR supersedes_decision_id <> id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_id_domain ON decisions(domain_id, decision_id);
        CREATE INDEX IF NOT EXISTS idx_decisions_domain ON decisions(domain_id, created_at);
      `,
      )
    },
  },
  {
    version: 4,
    description: 'Domain relationships, gap flags',
    up(db) {
      runSQL(
        db,
        `
        -- Domain relationships (bidirectional sibling links)
        CREATE TABLE IF NOT EXISTS domain_relationships (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          sibling_domain_id TEXT NOT NULL,
          relationship_type TEXT NOT NULL DEFAULT 'sibling',
          created_at TEXT NOT NULL,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
          FOREIGN KEY (sibling_domain_id) REFERENCES domains(id) ON DELETE CASCADE,
          UNIQUE(domain_id, sibling_domain_id),
          CHECK(domain_id <> sibling_domain_id),
          CHECK(relationship_type IN ('sibling','reference','parent'))
        );

        -- Gap flags (persistent with status lifecycle)
        CREATE TABLE IF NOT EXISTS gap_flags (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          session_id TEXT,
          category TEXT NOT NULL,
          description TEXT NOT NULL,
          source_message TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          resolved_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
          CHECK(status IN ('open','acknowledged','resolved'))
        );
        CREATE INDEX IF NOT EXISTS idx_gap_flags_domain ON gap_flags(domain_id, status);
      `,
      )
    },
  },
  {
    version: 5,
    description: 'Sessions table',
    up(db) {
      runSQL(
        db,
        `
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'working',
          status TEXT NOT NULL DEFAULT 'active',
          model_provider TEXT NOT NULL DEFAULT '',
          model_name TEXT NOT NULL DEFAULT '',
          started_at TEXT NOT NULL,
          ended_at TEXT,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
          CHECK(scope IN ('quick','working','prep')),
          CHECK(status IN ('active','wrapped_up'))
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_domain ON sessions(domain_id, status);
      `,
      )
    },
  },
  {
    version: 6,
    description: 'Intake external source support — source_type, external_id, metadata',
    up(db) {
      runSQL(
        db,
        `
        ALTER TABLE intake_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'web';
        ALTER TABLE intake_items ADD COLUMN external_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE intake_items ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

        -- Partial unique index: only enforced when external_id is non-empty
        CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_external_id
          ON intake_items(source_type, external_id)
          WHERE external_id <> '';
      `,
      )
    },
  },
  {
    version: 7,
    description: 'Per-domain Gmail access toggle',
    up(db) {
      runSQL(
        db,
        `ALTER TABLE domains ADD COLUMN allow_gmail INTEGER NOT NULL DEFAULT 0;`,
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
