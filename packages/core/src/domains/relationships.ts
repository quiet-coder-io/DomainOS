/**
 * Domain relationship repository — directed dependency edges.
 *
 * Relationships are stored as directed edges (from → to).
 * Optional reciprocation creates both directions in a single transaction.
 * Zod validates dependency_type since SQLite lacks ALTER TABLE ADD CHECK.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'

export type RelationshipType = 'sibling' | 'reference' | 'parent'

export const DependencyTypeSchema = z.enum([
  'blocks',
  'depends_on',
  'informs',
  'parallel',
  'monitor_only',
])
export type DependencyType = z.infer<typeof DependencyTypeSchema>

export interface DomainRelationship {
  id: string
  domainId: string
  siblingDomainId: string
  relationshipType: RelationshipType
  dependencyType: DependencyType
  description: string
  createdAt: string
}

export type RelationshipPerspective = 'outgoing' | 'incoming'

export interface RelationshipView extends DomainRelationship {
  perspective: RelationshipPerspective
  peerDomainId: string
  peerDomainName: string
  displayKey: string
}

export interface AddRelationshipOptions {
  relationshipType?: RelationshipType
  dependencyType?: DependencyType
  description?: string
  reciprocate?: boolean
  reciprocalType?: DependencyType
}

interface RelationshipRow {
  id: string
  domain_id: string
  sibling_domain_id: string
  relationship_type: string
  dependency_type: string
  description: string
  created_at: string
}

function rowToRelationship(row: RelationshipRow): DomainRelationship {
  return {
    id: row.id,
    domainId: row.domain_id,
    siblingDomainId: row.sibling_domain_id,
    relationshipType: row.relationship_type as RelationshipType,
    dependencyType: (row.dependency_type || 'informs') as DependencyType,
    description: row.description || '',
    createdAt: row.created_at,
  }
}

export class DomainRelationshipRepository {
  constructor(private db: Database.Database) {}

  /**
   * Add a directed relationship (from → to).
   * If reciprocate=true, also inserts to → from with reciprocalType.
   */
  addRelationship(
    fromDomainId: string,
    toDomainId: string,
    options: AddRelationshipOptions = {},
  ): Result<DomainRelationship, DomainOSError> {
    if (fromDomainId === toDomainId) {
      return Err(DomainOSError.validation('Cannot create self-referencing relationship'))
    }

    const relType = options.relationshipType ?? 'sibling'
    const depType = options.dependencyType ?? 'informs'
    const desc = options.description ?? ''
    const reciprocate = options.reciprocate ?? false
    const reciprocalType = options.reciprocalType ?? 'informs'

    // Validate dependency types via Zod
    const depValidation = DependencyTypeSchema.safeParse(depType)
    if (!depValidation.success) {
      return Err(DomainOSError.validation(`Invalid dependency type: ${depType}`))
    }
    if (reciprocate) {
      const recipValidation = DependencyTypeSchema.safeParse(reciprocalType)
      if (!recipValidation.success) {
        return Err(DomainOSError.validation(`Invalid reciprocal dependency type: ${reciprocalType}`))
      }
    }

    const now = new Date().toISOString()
    const id1 = uuidv4()

    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO domain_relationships (id, domain_id, sibling_domain_id, relationship_type, dependency_type, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(id1, fromDomainId, toDomainId, relType, depType, desc, now)

        if (reciprocate) {
          const id2 = uuidv4()
          this.db
            .prepare(
              'INSERT INTO domain_relationships (id, domain_id, sibling_domain_id, relationship_type, dependency_type, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(id2, toDomainId, fromDomainId, relType, reciprocalType, desc, now)
        }
      })()

      return Ok({
        id: id1,
        domainId: fromDomainId,
        siblingDomainId: toDomainId,
        relationshipType: relType,
        dependencyType: depType,
        description: desc,
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
   * Legacy: add bidirectional sibling relationship.
   * Preserved for backward compatibility during migration period.
   */
  addSibling(
    domainId: string,
    siblingDomainId: string,
    type: RelationshipType = 'sibling',
  ): Result<DomainRelationship, DomainOSError> {
    return this.addRelationship(domainId, siblingDomainId, {
      relationshipType: type,
      dependencyType: 'informs',
      reciprocate: true,
      reciprocalType: 'informs',
    })
  }

  /**
   * Remove a single directed relationship (from → to).
   */
  removeRelationship(fromDomainId: string, toDomainId: string): Result<void, DomainOSError> {
    try {
      this.db
        .prepare('DELETE FROM domain_relationships WHERE domain_id = ? AND sibling_domain_id = ?')
        .run(fromDomainId, toDomainId)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Remove both directions of a relationship pair.
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
   * Get all relationships for a domain — both outgoing and incoming.
   * Each row annotated with perspective and peer info.
   * Requires a domain name resolver function.
   */
  getRelationships(
    domainId: string,
    getDomainName: (id: string) => string,
  ): Result<RelationshipView[], DomainOSError> {
    try {
      // Query outgoing and incoming separately (no SQL UNION — avoids row-collapse edge cases)
      const outgoing = this.db
        .prepare('SELECT * FROM domain_relationships WHERE domain_id = ? ORDER BY created_at')
        .all(domainId) as RelationshipRow[]

      const incoming = this.db
        .prepare('SELECT * FROM domain_relationships WHERE sibling_domain_id = ? ORDER BY created_at')
        .all(domainId) as RelationshipRow[]

      const views: RelationshipView[] = []

      for (const row of outgoing) {
        const rel = rowToRelationship(row)
        const peerDomainId = rel.siblingDomainId
        views.push({
          ...rel,
          perspective: 'outgoing',
          peerDomainId,
          peerDomainName: getDomainName(peerDomainId),
          displayKey: [domainId, peerDomainId].sort().join(':'),
        })
      }

      for (const row of incoming) {
        const rel = rowToRelationship(row)
        const peerDomainId = rel.domainId
        views.push({
          ...rel,
          perspective: 'incoming',
          peerDomainId,
          peerDomainName: getDomainName(peerDomainId),
          displayKey: [domainId, peerDomainId].sort().join(':'),
        })
      }

      return Ok(views)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Get raw outgoing siblings for a domain (all relationship types).
   * Used by sibling context builder and other consumers that only need outgoing edges.
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
  getByType(
    domainId: string,
    type: RelationshipType,
  ): Result<DomainRelationship[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          'SELECT * FROM domain_relationships WHERE domain_id = ? AND relationship_type = ? ORDER BY created_at',
        )
        .all(domainId, type) as RelationshipRow[]
      return Ok(rows.map(rowToRelationship))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Get all relationships across all domains (for portfolio-level queries).
   */
  getAll(): Result<DomainRelationship[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM domain_relationships ORDER BY created_at')
        .all() as RelationshipRow[]
      return Ok(rows.map(rowToRelationship))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
