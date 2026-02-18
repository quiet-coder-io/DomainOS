/**
 * Domain relationship repository — manages bidirectional sibling links.
 * Adding A→B inserts two rows (A→B and B→A) for symmetric queries.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'

export type RelationshipType = 'sibling' | 'reference' | 'parent'

export interface DomainRelationship {
  id: string
  domainId: string
  siblingDomainId: string
  relationshipType: RelationshipType
  createdAt: string
}

interface RelationshipRow {
  id: string
  domain_id: string
  sibling_domain_id: string
  relationship_type: string
  created_at: string
}

function rowToRelationship(row: RelationshipRow): DomainRelationship {
  return {
    id: row.id,
    domainId: row.domain_id,
    siblingDomainId: row.sibling_domain_id,
    relationshipType: row.relationship_type as RelationshipType,
    createdAt: row.created_at,
  }
}

export class DomainRelationshipRepository {
  constructor(private db: Database.Database) {}

  /**
   * Add a bidirectional sibling relationship (inserts two rows: A→B and B→A).
   */
  addSibling(domainId: string, siblingDomainId: string, type: RelationshipType = 'sibling'): Result<DomainRelationship, DomainOSError> {
    if (domainId === siblingDomainId) {
      return Err(DomainOSError.validation('Cannot create self-referencing relationship'))
    }

    const now = new Date().toISOString()
    const id1 = uuidv4()
    const id2 = uuidv4()

    try {
      this.db.transaction(() => {
        this.db
          .prepare('INSERT INTO domain_relationships (id, domain_id, sibling_domain_id, relationship_type, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id1, domainId, siblingDomainId, type, now)

        this.db
          .prepare('INSERT INTO domain_relationships (id, domain_id, sibling_domain_id, relationship_type, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id2, siblingDomainId, domainId, type, now)
      })()

      return Ok({
        id: id1,
        domainId,
        siblingDomainId,
        relationshipType: type,
        createdAt: now,
      })
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('UNIQUE constraint')) {
        return Err(DomainOSError.validation('Relationship already exists between these domains'))
      }
      return Err(DomainOSError.db(msg))
    }
  }

  /**
   * Remove a bidirectional relationship (deletes both rows: A→B and B→A).
   */
  removeSibling(domainId: string, siblingDomainId: string): Result<void, DomainOSError> {
    try {
      this.db.transaction(() => {
        this.db
          .prepare('DELETE FROM domain_relationships WHERE domain_id = ? AND sibling_domain_id = ?')
          .run(domainId, siblingDomainId)

        this.db
          .prepare('DELETE FROM domain_relationships WHERE domain_id = ? AND sibling_domain_id = ?')
          .run(siblingDomainId, domainId)
      })()

      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Get all siblings for a domain (all relationship types).
   */
  getSiblings(domainId: string): Result<DomainRelationship[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM domain_relationships WHERE domain_id = ? ORDER BY created_at')
        .all(domainId) as RelationshipRow[]
      return Ok(rows.map(rowToRelationship))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Get siblings filtered by relationship type.
   */
  getByType(domainId: string, type: RelationshipType): Result<DomainRelationship[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM domain_relationships WHERE domain_id = ? AND relationship_type = ? ORDER BY created_at')
        .all(domainId, type) as RelationshipRow[]
      return Ok(rows.map(rowToRelationship))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
