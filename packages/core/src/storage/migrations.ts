/**
 * Version-based SQLite migrations.
 */

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'

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
  {
    version: 8,
    description: 'Per-domain LLM model override and force-tool-attempt flag',
    up(db) {
      runSQL(
        db,
        `
        ALTER TABLE domains ADD COLUMN model_provider TEXT DEFAULT NULL;
        ALTER TABLE domains ADD COLUMN model_name TEXT DEFAULT NULL;
        ALTER TABLE domains ADD COLUMN force_tool_attempt INTEGER DEFAULT 0;
        `,
      )
    },
  },
  {
    version: 9,
    description: 'Directed domain relationships — dependency type and description',
    up(db) {
      runSQL(
        db,
        `
        ALTER TABLE domain_relationships ADD COLUMN dependency_type TEXT NOT NULL DEFAULT 'informs';
        ALTER TABLE domain_relationships ADD COLUMN description TEXT NOT NULL DEFAULT '';
        `,
      )
    },
  },
  {
    version: 10,
    description: 'Deadlines — per-domain triggered deadline tracking + audit event type expansion',
    up(db) {
      // Expand audit_log CHECK constraint to include 'deadline_lifecycle'.
      // SQLite cannot ALTER CHECK constraints, so recreate the table.
      runSQL(
        db,
        `
        CREATE TABLE IF NOT EXISTS audit_log_new (
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
          CHECK(event_type IN ('kb_write','cross_domain_read','decision_created','session_start','session_wrap','deadline_lifecycle'))
        );
        INSERT INTO audit_log_new SELECT * FROM audit_log;
        DROP TABLE audit_log;
        ALTER TABLE audit_log_new RENAME TO audit_log;
        CREATE INDEX IF NOT EXISTS idx_audit_log_domain ON audit_log(domain_id, created_at);
        `,
      )

      runSQL(
        db,
        `
        CREATE TABLE IF NOT EXISTS deadlines (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL,
          text TEXT NOT NULL,
          due_date TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 4,
          status TEXT NOT NULL DEFAULT 'active',
          source TEXT NOT NULL DEFAULT 'manual',
          source_ref TEXT NOT NULL DEFAULT '',
          snoozed_until TEXT,
          completed_at TEXT,
          cancelled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
          CHECK(status IN ('active','snoozed','completed','cancelled')),
          CHECK(priority >= 1 AND priority <= 7),
          CHECK(due_date GLOB '????-??-??'),
          CHECK(snoozed_until IS NULL OR snoozed_until GLOB '????-??-??')
        );

        CREATE INDEX IF NOT EXISTS idx_deadlines_domain_status ON deadlines(domain_id, status);
        CREATE INDEX IF NOT EXISTS idx_deadlines_due ON deadlines(due_date, status);
        CREATE INDEX IF NOT EXISTS idx_deadlines_domain_due_status ON deadlines(domain_id, status, due_date);
        CREATE INDEX IF NOT EXISTS idx_deadlines_active_due ON deadlines(due_date) WHERE status = 'active';
        `,
      )
    },
  },
  {
    version: 11,
    description: 'Decision metadata — confidence, horizon, reversibility, category',
    up(db) {
      runSQL(
        db,
        `
        ALTER TABLE decisions ADD COLUMN confidence TEXT CHECK(confidence IN ('high','medium','low'));
        ALTER TABLE decisions ADD COLUMN horizon TEXT CHECK(horizon IN ('immediate','near_term','strategic'));
        ALTER TABLE decisions ADD COLUMN reversibility_class TEXT CHECK(reversibility_class IN ('reversible','irreversible'));
        ALTER TABLE decisions ADD COLUMN reversibility_notes TEXT;
        ALTER TABLE decisions ADD COLUMN category TEXT CHECK(category IN ('strategic','tactical','operational'));
        `,
      )
    },
  },
  {
    version: 12,
    description: 'Advisory artifacts — structured strategic reasoning storage',
    up(db) {
      runSQL(
        db,
        `
        CREATE TABLE IF NOT EXISTS advisory_artifacts (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
          session_id TEXT,
          type TEXT NOT NULL CHECK(type IN ('brainstorm','risk_assessment','scenario','strategic_review')),
          title TEXT NOT NULL,
          llm_title TEXT NOT NULL DEFAULT '',
          schema_version INTEGER NOT NULL DEFAULT 1,
          content TEXT NOT NULL DEFAULT '{}',
          fingerprint TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'llm' CHECK(source IN ('llm','user','import')),
          source_message_id TEXT DEFAULT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
          archived_at TEXT DEFAULT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_artifact_domain_type ON advisory_artifacts(domain_id, type);
        CREATE INDEX idx_artifact_domain_created ON advisory_artifacts(domain_id, created_at);
        CREATE UNIQUE INDEX idx_artifact_fingerprint ON advisory_artifacts(domain_id, fingerprint) WHERE fingerprint != '';
        `,
      )
    },
  },
  {
    version: 13,
    description: 'Automations — domain-scoped triggers, prompt execution, and action pipeline',
    up(db) {
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS automations (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
          name TEXT NOT NULL CHECK (length(name) <= 100),
          description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
          trigger_type TEXT NOT NULL CHECK (trigger_type IN ('schedule','event','manual')),
          trigger_cron TEXT,
          trigger_event TEXT CHECK (trigger_event IN ('intake_created','kb_changed','gap_flag_raised','deadline_approaching')),
          prompt_template TEXT NOT NULL CHECK (length(prompt_template) <= 20000),
          action_type TEXT NOT NULL CHECK (action_type IN ('notification','create_gtask','draft_gmail')),
          action_config TEXT NOT NULL DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
          catch_up_enabled INTEGER NOT NULL DEFAULT 0 CHECK (catch_up_enabled IN (0,1)),
          store_payloads INTEGER NOT NULL DEFAULT 0 CHECK (store_payloads IN (0,1)),
          deadline_window_days INTEGER CHECK (deadline_window_days IS NULL OR deadline_window_days BETWEEN 1 AND 60),
          next_run_at TEXT,
          failure_streak INTEGER NOT NULL DEFAULT 0 CHECK (failure_streak >= 0),
          cooldown_until TEXT,
          last_run_at TEXT,
          last_error TEXT,
          run_count INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
          duplicate_skip_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_skip_count >= 0),
          last_duplicate_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (trigger_type = 'schedule' AND trigger_cron IS NOT NULL AND trigger_event IS NULL)
            OR (trigger_type = 'event' AND trigger_cron IS NULL AND trigger_event IS NOT NULL)
            OR (trigger_type = 'manual' AND trigger_cron IS NULL AND trigger_event IS NULL)
          ),
          CHECK (trigger_type = 'schedule' OR next_run_at IS NULL),
          CHECK (trigger_type = 'schedule' OR catch_up_enabled = 0),
          CHECK (
            (trigger_type = 'event' AND trigger_event = 'deadline_approaching')
            OR deadline_window_days IS NULL
          )
        );

        CREATE INDEX IF NOT EXISTS automations_domain_id_idx ON automations(domain_id);
        CREATE INDEX IF NOT EXISTS automations_enabled_trigger_type_idx ON automations(enabled, trigger_type);
        CREATE INDEX IF NOT EXISTS automations_trigger_event_idx ON automations(trigger_event) WHERE trigger_event IS NOT NULL;

        CREATE TABLE IF NOT EXISTS automation_runs (
          id TEXT PRIMARY KEY,
          automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
          trigger_type TEXT NOT NULL CHECK (trigger_type IN ('schedule','event','manual')),
          trigger_event TEXT CHECK (trigger_event IN ('intake_created','kb_changed','gap_flag_raised','deadline_approaching')),
          trigger_data TEXT,
          dedupe_key TEXT,
          prompt_hash TEXT,
          prompt_rendered TEXT,
          response_hash TEXT,
          llm_response TEXT,
          action_type TEXT NOT NULL CHECK (action_type IN ('notification','create_gtask','draft_gmail')),
          action_result TEXT NOT NULL DEFAULT '',
          action_external_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','failed','skipped')),
          error TEXT,
          error_code TEXT,
          duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          updated_at TEXT NOT NULL,
          CHECK (
            (status = 'pending' AND started_at IS NULL AND completed_at IS NULL)
            OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
            OR (status IN ('success','failed','skipped') AND completed_at IS NOT NULL)
          ),
          CHECK (status = 'skipped' OR dedupe_key IS NOT NULL),
          CHECK (
            (trigger_type = 'event' AND trigger_event IS NOT NULL)
            OR (trigger_type != 'event' AND trigger_event IS NULL)
          ),
          CHECK (trigger_data IS NULL OR length(trigger_data) <= 20000),
          CHECK (prompt_rendered IS NULL OR length(prompt_rendered) <= 100000),
          CHECK (llm_response IS NULL OR length(llm_response) <= 200000)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_dedupe_key_uniq ON automation_runs(dedupe_key) WHERE dedupe_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS automation_runs_automation_created_idx ON automation_runs(automation_id, created_at);
        CREATE INDEX IF NOT EXISTS automation_runs_domain_created_idx ON automation_runs(domain_id, created_at);
        CREATE INDEX IF NOT EXISTS automation_runs_status_hot_idx ON automation_runs(status, created_at) WHERE status IN ('pending','running');
        CREATE INDEX IF NOT EXISTS automation_runs_automation_status_created_idx ON automation_runs(automation_id, status, created_at);
      `)
    },
  },
  {
    version: 14,
    description: 'Brainstorm sessions — deep technique-driven creative sessions with structured synthesis',
    up(db) {
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS brainstorm_sessions (
          id TEXT PRIMARY KEY,
          session_id TEXT REFERENCES sessions(id),
          domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
          schema_version INTEGER NOT NULL DEFAULT 1,
          step TEXT NOT NULL DEFAULT 'setup' CHECK(step IN ('setup','technique_selection','execution','synthesis','completed')),
          phase TEXT NOT NULL DEFAULT 'divergent' CHECK(phase IN ('divergent','convergent')),
          is_paused INTEGER NOT NULL DEFAULT 0 CHECK(is_paused IN (0,1)),
          topic TEXT NOT NULL DEFAULT '',
          goals TEXT NOT NULL DEFAULT '',
          selected_techniques TEXT NOT NULL DEFAULT '[]',
          rounds TEXT NOT NULL DEFAULT '[]',
          raw_ideas TEXT NOT NULL DEFAULT '[]',
          idea_count INTEGER NOT NULL DEFAULT 0,
          -- synthesis_preview stores JSON {schemaVersion, payload, hash}; kept as TEXT for portability/migrations.
          synthesis_preview TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_brainstorm_domain ON brainstorm_sessions(domain_id);
        CREATE INDEX idx_brainstorm_session ON brainstorm_sessions(session_id);
        -- Paused sessions hold the slot intentionally; resume/close required before starting a new session.
        CREATE UNIQUE INDEX idx_brainstorm_one_active_per_domain
          ON brainstorm_sessions(domain_id) WHERE step != 'completed';
      `)
    },
  },
  {
    version: 15,
    description: 'Domain tags — filterable key-value metadata for domains',
    up(db) {
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS domain_tags (
          id TEXT PRIMARY KEY,
          domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
          key TEXT NOT NULL CHECK(length(key) <= 32),
          value TEXT NOT NULL CHECK(length(value) <= 128),
          value_norm TEXT NOT NULL CHECK(length(value_norm) <= 128),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX idx_domain_tags_unique ON domain_tags(domain_id, key, value_norm);
        CREATE INDEX idx_domain_tags_key_value ON domain_tags(key, value_norm);
        CREATE INDEX idx_domain_tags_domain ON domain_tags(domain_id);
      `)
    },
  },
  {
    version: 16,
    description: 'Skills — user-activated procedural expertise for per-message prompt injection',
    up(db) {
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0),
          description TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL CHECK(length(trim(content)) > 0),
          output_format TEXT NOT NULL DEFAULT 'freeform' CHECK(output_format IN ('freeform','structured')),
          output_schema TEXT,
          tool_hints TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tool_hints)),
          is_enabled INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_skills_sort ON skills(is_enabled, sort_order, name);
      `)
    },
  },
  {
    version: 17,
    description: 'Chat message persistence — status, metadata, ordering index',
    up(db) {
      const cols = db.pragma('table_info(chat_messages)') as Array<{ name: string }>
      const colNames = new Set(cols.map(c => c.name))
      if (!colNames.has('status')) {
        runSQL(db, `ALTER TABLE chat_messages ADD COLUMN status TEXT`)
      }
      if (!colNames.has('metadata')) {
        runSQL(db, `ALTER TABLE chat_messages ADD COLUMN metadata TEXT`)
      }
      runSQL(db, `CREATE INDEX IF NOT EXISTS idx_chat_messages_domain_order ON chat_messages(domain_id, created_at, id)`)
    },
  },
  {
    version: 18,
    description: 'Mission system — definitions, runs, outputs, gates, actions + audit_log CHECK drop',
    up(db) {
      // ── 1. Mission definitions (global, not domain-scoped) ──
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS missions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE CHECK(length(name) > 0 AND length(name) <= 100),
          version INTEGER NOT NULL DEFAULT 1,
          definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
          definition_hash TEXT NOT NULL DEFAULT '',
          seed_source TEXT NOT NULL DEFAULT 'system',
          seed_version TEXT NOT NULL DEFAULT 'v1.0.0',
          is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0,1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)

      // ── 2. Junction: which domains can run which missions ──
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS mission_domain_assoc (
          mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
          domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
          is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0,1)),
          created_at TEXT NOT NULL,
          PRIMARY KEY (mission_id, domain_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mission_domain_domain ON mission_domain_assoc(domain_id);
      `)

      // ── 3. Mission run instances (immutable audit spine) ──
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS mission_runs (
          id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
          domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','running','gated','success','failed','cancelled')),
          inputs_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(inputs_json)),
          mission_definition_hash TEXT NOT NULL DEFAULT '',
          prompt_hash TEXT NOT NULL DEFAULT '',
          model_id TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT '',
          context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
          request_id TEXT,
          started_at TEXT,
          ended_at TEXT,
          duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mission_runs_domain ON mission_runs(domain_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_mission_runs_status ON mission_runs(status) WHERE status IN ('pending','running','gated');
      `)

      // ── 4. Parsed outputs from a run ──
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS mission_run_outputs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES mission_runs(id) ON DELETE CASCADE,
          output_type TEXT NOT NULL CHECK(length(output_type) > 0),
          content_json TEXT NOT NULL CHECK(json_valid(content_json)),
          artifact_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mission_run_outputs_run ON mission_run_outputs(run_id);
      `)

      // ── 5. Approval gates ──
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS mission_run_gates (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES mission_runs(id) ON DELETE CASCADE,
          gate_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
          message TEXT NOT NULL DEFAULT '',
          decided_at TEXT,
          decided_by TEXT NOT NULL DEFAULT 'user',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mission_run_gates_run ON mission_run_gates(run_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_run_gates_unique ON mission_run_gates(run_id, gate_id);
      `)

      // ── 6. Side-effect actions ──
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS mission_run_actions (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES mission_runs(id) ON DELETE CASCADE,
          action_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('create_deadline','draft_email','notification')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','failed','skipped')),
          result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result_json)),
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mission_run_actions_run ON mission_run_actions(run_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_run_actions_unique ON mission_run_actions(run_id, action_id);
      `)

      // ── 7. Drop CHECK on audit_log.event_type (Zod-only enforcement going forward) ──
      runSQL(db, `
        CREATE TABLE IF NOT EXISTS audit_log_new (
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
          FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
        );
        INSERT INTO audit_log_new (
          id, domain_id, session_id, agent_name, file_path,
          change_description, content_hash, event_type, source,
          created_at, updated_at
        )
        SELECT
          id, domain_id, session_id, agent_name, file_path,
          change_description, content_hash, event_type, source,
          created_at, updated_at
        FROM audit_log;
        DROP TABLE audit_log;
        ALTER TABLE audit_log_new RENAME TO audit_log;
        CREATE INDEX IF NOT EXISTS idx_audit_log_domain ON audit_log(domain_id, created_at);
      `)

      // ── 8. Seed Portfolio Briefing mission definition ──
      const definition = {
        type: 'portfolio-briefing',
        description: 'Cross-domain portfolio health briefing with alerts, actions, monitors, and optional side effects (deadlines, email draft).',
        steps: [
          'compute-health',
          'load-digests',
          'build-prompt',
          'stream-llm',
          'parse-outputs',
          'evaluate-gates',
          'execute-actions',
        ],
        gates: [
          {
            id: 'side-effects',
            description: 'Approve creation of deadlines and/or email draft',
            triggeredWhen: 'actions-requested',
          },
        ],
        actions: [
          { id: 'create-deadlines', type: 'create_deadline', description: 'Create deadlines from parsed actions' },
          { id: 'draft-email', type: 'draft_email', description: 'Draft summary email to specified recipient' },
        ],
        parameters: {
          createDeadlines: { type: 'boolean', default: false, description: 'Auto-create deadlines from parsed actions' },
          draftEmailTo: { type: 'string', default: '', description: 'Email recipient for summary draft (empty = skip)' },
        },
      }

      // Canonical JSON: stable key sort → stringify → SHA-256
      const canonicalJson = JSON.stringify(definition, Object.keys(definition).sort())
      const definitionHash = createHash('sha256').update(canonicalJson).digest('hex')
      const now = new Date().toISOString()
      const missionId = 'portfolio-briefing'

      db.prepare(`
        INSERT OR IGNORE INTO missions (id, name, version, definition_json, definition_hash, seed_source, seed_version, is_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(missionId, 'Portfolio Briefing', 1, canonicalJson, definitionHash, 'system', 'v1.0.0', 1, now, now)
    },
  },
  {
    version: 19,
    description: 'Loan Document Review mission — single-domain CMBS loan doc review with attorney memo output',
    up(db) {
      const definition = {
        type: 'loan-document-review',
        description: 'CMBS-methodology loan document review producing a structured attorney memo and risk heatmap.',
        scope: 'single-domain',
        methodology: 'CMBS Loan Review',
        outputLabels: ['Attorney Memo', 'Risk Heatmap'],
        parametersOrder: ['reviewDepth', 'docPaths', 'draftEmailTo'],
        steps: [
          'load-kb',
          'build-prompt',
          'stream-llm',
          'parse-outputs',
          'evaluate-gates',
          'execute-actions',
        ],
        gates: [
          {
            id: 'side-effects',
            description: 'Approve attorney memo email draft',
            triggeredWhen: 'email-requested',
          },
        ],
        actions: [
          { id: 'draft-email', type: 'draft_email', description: 'Draft attorney memo email' },
        ],
        parameters: {
          reviewDepth: { type: 'string', default: 'attorney-prep', description: 'triage | attorney-prep | full-review' },
          docPaths: { type: 'string', default: '', description: 'Comma/newline-separated KB paths (empty = full digest)' },
          draftEmailTo: { type: 'string', default: '', description: 'Attorney email for memo draft (empty = skip)' },
        },
      }

      // Deep-sort canonicalizer for stable hash
      function deepSort(obj: unknown): unknown {
        if (Array.isArray(obj)) return obj.map(deepSort)
        if (obj !== null && typeof obj === 'object') {
          const sorted: Record<string, unknown> = {}
          for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
            sorted[key] = deepSort((obj as Record<string, unknown>)[key])
          }
          return sorted
        }
        return obj
      }

      const canonicalJson = JSON.stringify(deepSort(definition))
      const definitionHash = createHash('sha256').update(canonicalJson).digest('hex')
      const now = new Date().toISOString()
      const missionId = 'loan-document-review'

      db.prepare(`
        INSERT OR IGNORE INTO missions (id, name, version, definition_json, definition_hash, seed_source, seed_version, is_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(missionId, 'Loan Document Review', 1, canonicalJson, definitionHash, 'system', 'v1.0.0', 1, now, now)
    },
  },
  {
    version: 20,
    description: 'Add methodology + outputLabels to mission definitions',
    up(db) {
      function deepSort(obj: unknown): unknown {
        if (Array.isArray(obj)) return obj.map(deepSort)
        if (obj !== null && typeof obj === 'object') {
          const sorted: Record<string, unknown> = {}
          for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
            sorted[key] = deepSort((obj as Record<string, unknown>)[key])
          }
          return sorted
        }
        return obj
      }

      const updates: Array<{ id: string; methodology: string; outputLabels: string[] }> = [
        { id: 'loan-document-review', methodology: 'CMBS Loan Review', outputLabels: ['Attorney Memo', 'Risk Heatmap'] },
        { id: 'portfolio-briefing', methodology: 'Portfolio Health Analysis', outputLabels: ['Alerts', 'Actions', 'Monitors'] },
      ]

      for (const { id, methodology, outputLabels } of updates) {
        const row = db.prepare('SELECT definition_json FROM missions WHERE id = ?').get(id) as { definition_json: string } | undefined
        if (!row) continue

        const def = JSON.parse(row.definition_json)
        if (def.methodology) continue // already patched

        def.methodology = methodology
        def.outputLabels = outputLabels

        const canonicalJson = JSON.stringify(deepSort(def))
        const definitionHash = createHash('sha256').update(canonicalJson).digest('hex')
        const now = new Date().toISOString()

        db.prepare('UPDATE missions SET definition_json = ?, definition_hash = ?, updated_at = ? WHERE id = ?')
          .run(canonicalJson, definitionHash, now, id)
      }
    },
  },
  {
    version: 21,
    description: 'Add sort_order to domains for manual ordering',
    up(db) {
      runSQL(db, `ALTER TABLE domains ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`)
      // Backfill: oldest domain = 0, newest = N (preserves created_at order)
      const rows = db.prepare('SELECT id FROM domains ORDER BY created_at ASC').all() as Array<{ id: string }>
      const stmt = db.prepare('UPDATE domains SET sort_order = ? WHERE id = ?')
      rows.forEach((row, i) => stmt.run(i, row.id))
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
