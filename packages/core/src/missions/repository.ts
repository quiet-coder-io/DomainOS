/**
 * Mission definition CRUD + domain association management.
 */

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { Ok, Err } from '../common/result.js'
import { DomainOSError } from '../common/errors.js'
import type { Result } from '../common/result.js'
import type { Mission, MissionDefinition, MissionDomainAssoc, MissionSummary } from './schemas.js'

// ── Row types ──

interface MissionRow {
  id: string
  name: string
  version: number
  definition_json: string
  definition_hash: string
  seed_source: string
  seed_version: string
  is_enabled: number
  created_at: string
  updated_at: string
}

interface MissionDomainAssocRow {
  mission_id: string
  domain_id: string
  is_enabled: number
  created_at: string
}

// ── Helpers ──

/**
 * Compute canonical hash: parse → stable key sort → stringify → SHA-256.
 */
export function computeDefinitionHash(definitionJson: string): { canonical: string; hash: string } {
  const parsed = JSON.parse(definitionJson)
  const canonical = JSON.stringify(parsed, Object.keys(parsed).sort())
  const hash = createHash('sha256').update(canonical).digest('hex')
  return { canonical, hash }
}

function rowToMission(row: MissionRow): Mission {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    definition: JSON.parse(row.definition_json) as MissionDefinition,
    definitionHash: row.definition_hash,
    seedSource: row.seed_source,
    seedVersion: row.seed_version,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function missionToSummary(mission: Mission): MissionSummary {
  return {
    id: mission.id,
    name: mission.name,
    version: mission.version,
    description: mission.definition.description,
    isEnabled: mission.isEnabled,
    parameters: mission.definition.parameters,
  }
}

// ── Repository ──

export class MissionRepository {
  constructor(private db: Database.Database) {}

  list(): Result<Mission[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM missions WHERE is_enabled = 1 ORDER BY name')
        .all() as MissionRow[]
      return Ok(rows.map(rowToMission))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listSummaries(): Result<MissionSummary[], DomainOSError> {
    const result = this.list()
    if (!result.ok) return result
    return Ok(result.value.map(missionToSummary))
  }

  getById(id: string): Result<Mission, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM missions WHERE id = ?')
        .get(id) as MissionRow | undefined
      if (!row) return Err(DomainOSError.notFound('Mission', id))
      return Ok(rowToMission(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listForDomain(domainId: string): Result<Mission[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(`
          SELECT m.* FROM missions m
          JOIN mission_domain_assoc mda ON m.id = mda.mission_id
          WHERE mda.domain_id = ? AND mda.is_enabled = 1 AND m.is_enabled = 1
          ORDER BY m.name
        `)
        .all(domainId) as MissionRow[]
      return Ok(rows.map(rowToMission))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listSummariesForDomain(domainId: string): Result<MissionSummary[], DomainOSError> {
    const result = this.listForDomain(domainId)
    if (!result.ok) return result
    return Ok(result.value.map(missionToSummary))
  }

  enableForDomain(missionId: string, domainId: string): Result<void, DomainOSError> {
    try {
      const now = new Date().toISOString()
      this.db
        .prepare(`
          INSERT INTO mission_domain_assoc (mission_id, domain_id, is_enabled, created_at)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(mission_id, domain_id) DO UPDATE SET is_enabled = 1
        `)
        .run(missionId, domainId, now)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  disableForDomain(missionId: string, domainId: string): Result<void, DomainOSError> {
    try {
      this.db
        .prepare(`
          UPDATE mission_domain_assoc SET is_enabled = 0
          WHERE mission_id = ? AND domain_id = ?
        `)
        .run(missionId, domainId)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  isDomainEnabled(missionId: string, domainId: string): Result<boolean, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT is_enabled FROM mission_domain_assoc WHERE mission_id = ? AND domain_id = ?')
        .get(missionId, domainId) as MissionDomainAssocRow | undefined
      return Ok(row?.is_enabled === 1)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getDomainAssociations(missionId: string): Result<MissionDomainAssoc[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM mission_domain_assoc WHERE mission_id = ?')
        .all(missionId) as MissionDomainAssocRow[]
      return Ok(rows.map((row) => ({
        missionId: row.mission_id,
        domainId: row.domain_id,
        isEnabled: row.is_enabled === 1,
        createdAt: row.created_at,
      })))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
