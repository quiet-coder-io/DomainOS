/**
 * KB file repository — syncs scanned files with the database.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { KBFile, KBScannedFile, KBSyncResult } from './schemas.js'

interface KBFileRow {
  id: string
  domain_id: string
  relative_path: string
  content_hash: string
  size_bytes: number
  last_synced_at: string
}

export class KBRepository {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  sync(domainId: string, scannedFiles: KBScannedFile[]): Result<KBSyncResult, DomainOSError> {
    try {
      const now = new Date().toISOString()
      let added = 0
      let updated = 0
      let deleted = 0

      const existing = this.db
        .prepare('SELECT id, relative_path, content_hash FROM kb_files WHERE domain_id = ?')
        .all(domainId) as Array<{ id: string; relative_path: string; content_hash: string }>

      const existingByPath = new Map(existing.map((row) => [row.relative_path, row]))
      const scannedPaths = new Set(scannedFiles.map((f) => f.relativePath))

      this.db.transaction(() => {
        // Insert new and update changed
        for (const scanned of scannedFiles) {
          const dbRow = existingByPath.get(scanned.relativePath)
          if (!dbRow) {
            this.db
              .prepare(
                'INSERT INTO kb_files (id, domain_id, relative_path, content_hash, size_bytes, last_synced_at) VALUES (?, ?, ?, ?, ?, ?)',
              )
              .run(uuidv4(), domainId, scanned.relativePath, scanned.hash, scanned.sizeBytes, now)
            added++
          } else if (dbRow.content_hash !== scanned.hash) {
            this.db
              .prepare(
                'UPDATE kb_files SET content_hash = ?, size_bytes = ?, last_synced_at = ? WHERE id = ?',
              )
              .run(scanned.hash, scanned.sizeBytes, now, dbRow.id)
            updated++
          }
        }

        // Delete removed
        for (const row of existing) {
          if (!scannedPaths.has(row.relative_path)) {
            this.db.prepare('DELETE FROM kb_files WHERE id = ?').run(row.id)
            deleted++
          }
        }
      })()

      return Ok({ added, updated, deleted })
    } catch (err) {
      return Err(
        DomainOSError.db(`KB sync failed: ${err instanceof Error ? err.message : String(err)}`),
      )
    }
  }

  getFiles(domainId: string): Result<KBFile[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM kb_files WHERE domain_id = ?')
        .all(domainId) as KBFileRow[]

      const files: KBFile[] = rows.map((row) => ({
        id: row.id,
        domainId: row.domain_id,
        relativePath: row.relative_path,
        contentHash: row.content_hash,
        sizeBytes: row.size_bytes,
        lastSyncedAt: row.last_synced_at,
      }))

      return Ok(files)
    } catch (err) {
      return Err(
        DomainOSError.db(
          `Failed to get KB files: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    }
  }
}
