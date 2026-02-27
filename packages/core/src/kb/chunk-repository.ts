/**
 * KB chunk repository — CRUD for chunks, embeddings, and indexing job status.
 * Follows existing repository pattern: constructor(db), methods return Result<T>.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type {
  StoredEmbedding,
  EmbeddingJobStatus,
  SyncChunksResult,
  ChunkForEmbedding,
} from './schemas.js'
import type { KBChunkData } from './chunker.js'
import { packFloat32, unpackFloat32 } from './vector-search.js'

interface ChunkRow {
  id: string
  kb_file_id: string
  domain_id: string
  chunk_index: number
  chunk_key: string
  heading_path: string
  content: string
  content_hash: string
  file_content_hash: string
  char_count: number
  token_estimate: number
  start_line: number | null
  end_line: number | null
  created_at: string
  updated_at: string
}

interface EmbeddingRow {
  id: string
  chunk_id: string
  model_name: string
  dimensions: number
  embedding: Buffer
  content_hash: string
  provider_fingerprint: string
  created_at: string
  // Joined from kb_chunks
  kb_file_id: string
  domain_id: string
  heading_path: string
  content: string
  char_count: number
  token_estimate: number
  start_line: number | null
  end_line: number | null
}

interface JobRow {
  domain_id: string
  model_name: string
  run_id: string | null
  provider_fingerprint: string
  status: string
  total_files: number
  processed_files: number
  total_chunks: number
  embedded_chunks: number
  last_error: string | null
  started_at: string | null
  updated_at: string
}

export interface EmbeddingBatch {
  chunkId: string
  modelName: string
  dimensions: number
  embedding: number[]
  contentHash: string
  providerFingerprint: string
}

export class KBChunkRepository {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * Sync chunks for a KB file. Matches by chunk_key:
   * - key exists + content_hash unchanged → skip
   * - key exists + content_hash changed → update
   * - key missing → insert
   * - existing keys not in incoming set → delete (embeddings cascade)
   * Always reads domain_id from kb_files record.
   */
  syncChunks(kbFileId: string, fileContentHash: string, chunks: KBChunkData[]): Result<SyncChunksResult, DomainOSError> {
    try {
      // Read domain_id from kb_files — never trust caller input
      const fileRow = this.db.prepare('SELECT domain_id FROM kb_files WHERE id = ?').get(kbFileId) as { domain_id: string } | undefined
      if (!fileRow) {
        return Err(DomainOSError.notFound('kb_files', kbFileId))
      }
      const domainId = fileRow.domain_id

      const insertedIds: string[] = []
      const updatedIds: string[] = []
      const unchangedIds: string[] = []

      this.db.transaction(() => {
        const existing = this.db
          .prepare('SELECT id, chunk_key, content_hash FROM kb_chunks WHERE kb_file_id = ?')
          .all(kbFileId) as Array<{ id: string; chunk_key: string; content_hash: string }>

        const existingByKey = new Map(existing.map(row => [row.chunk_key, row]))
        const incomingKeys = new Set(chunks.map(c => c.chunkKey))
        const now = new Date().toISOString()

        for (const chunk of chunks) {
          const dbRow = existingByKey.get(chunk.chunkKey)
          if (!dbRow) {
            // Insert new chunk
            const id = uuidv4()
            this.db.prepare(`
              INSERT INTO kb_chunks (id, kb_file_id, domain_id, chunk_index, chunk_key, heading_path, content, content_hash, file_content_hash, char_count, token_estimate, start_line, end_line, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, kbFileId, domainId, chunk.chunkIndex, chunk.chunkKey, chunk.headingPath, chunk.content, chunk.contentHash, fileContentHash, chunk.charCount, chunk.tokenEstimate, chunk.startLine, chunk.endLine, now, now)
            insertedIds.push(id)
          } else if (dbRow.content_hash !== chunk.contentHash) {
            // Update changed chunk
            this.db.prepare(`
              UPDATE kb_chunks SET chunk_index = ?, heading_path = ?, content = ?, content_hash = ?, file_content_hash = ?, char_count = ?, token_estimate = ?, start_line = ?, end_line = ?, updated_at = ?
              WHERE id = ?
            `).run(chunk.chunkIndex, chunk.headingPath, chunk.content, chunk.contentHash, fileContentHash, chunk.charCount, chunk.tokenEstimate, chunk.startLine, chunk.endLine, now, dbRow.id)
            updatedIds.push(dbRow.id)
          } else {
            unchangedIds.push(dbRow.id)
          }
        }

        // Delete removed chunks (embeddings cascade via FK)
        for (const row of existing) {
          if (!incomingKeys.has(row.chunk_key)) {
            this.db.prepare('DELETE FROM kb_chunks WHERE id = ?').run(row.id)
          }
        }
      })()

      return Ok({ insertedIds, updatedIds, unchangedIds })
    } catch (err) {
      return Err(DomainOSError.db(`Chunk sync failed: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /**
   * Get chunks that need embedding: no embedding exists, or content changed, or fingerprint changed.
   */
  getChunksNeedingEmbedding(domainId: string, modelName: string, providerFingerprint?: string): Result<ChunkForEmbedding[], DomainOSError> {
    try {
      // Chunks with no embedding for this model
      let rows = this.db.prepare(`
        SELECT c.id, c.content, c.content_hash
        FROM kb_chunks c
        LEFT JOIN kb_chunk_embeddings e ON e.chunk_id = c.id AND e.model_name = ?
        WHERE c.domain_id = ?
        AND (
          e.id IS NULL
          OR e.content_hash != c.content_hash
          ${providerFingerprint ? 'OR e.provider_fingerprint != ?' : ''}
        )
      `).all(...(providerFingerprint
        ? [modelName, domainId, providerFingerprint]
        : [modelName, domainId]
      )) as Array<{ id: string; content: string; content_hash: string }>

      // Filter out tiny chunks that would produce garbage embeddings
      rows = rows.filter(r => r.content.length >= 10)

      return Ok(rows.map(r => ({ id: r.id, content: r.content, contentHash: r.content_hash })))
    } catch (err) {
      return Err(DomainOSError.db(`Failed to get chunks needing embedding: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /**
   * Store embeddings — upsert via DELETE + INSERT for UNIQUE(chunk_id, model_name).
   */
  storeEmbeddings(embeddings: EmbeddingBatch[]): Result<number, DomainOSError> {
    try {
      let stored = 0
      this.db.transaction(() => {
        const deleteStmt = this.db.prepare('DELETE FROM kb_chunk_embeddings WHERE chunk_id = ? AND model_name = ?')
        const insertStmt = this.db.prepare(`
          INSERT INTO kb_chunk_embeddings (id, chunk_id, model_name, dimensions, embedding, content_hash, provider_fingerprint, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const now = new Date().toISOString()

        for (const emb of embeddings) {
          deleteStmt.run(emb.chunkId, emb.modelName)
          const blob = packFloat32(emb.embedding)
          insertStmt.run(uuidv4(), emb.chunkId, emb.modelName, emb.dimensions, blob, emb.contentHash, emb.providerFingerprint, now)
          stored++
        }
      })()

      return Ok(stored)
    } catch (err) {
      return Err(DomainOSError.db(`Failed to store embeddings: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /**
   * Get all embeddings for a domain + model, joined with chunk metadata.
   */
  getEmbeddings(domainId: string, modelName: string): Result<StoredEmbedding[], DomainOSError> {
    try {
      const rows = this.db.prepare(`
        SELECT
          e.id, e.chunk_id, e.model_name, e.dimensions, e.embedding,
          e.content_hash, e.provider_fingerprint, e.created_at,
          c.kb_file_id, c.domain_id, c.heading_path, c.content,
          c.char_count, c.token_estimate, c.start_line, c.end_line
        FROM kb_chunk_embeddings e
        JOIN kb_chunks c ON c.id = e.chunk_id
        WHERE c.domain_id = ? AND e.model_name = ?
      `).all(domainId, modelName) as EmbeddingRow[]

      const results: StoredEmbedding[] = []
      for (const row of rows) {
        const vec = unpackFloat32(row.embedding, row.dimensions)
        if (!vec) continue // Skip corrupt embeddings
        results.push({
          chunkId: row.chunk_id,
          kbFileId: row.kb_file_id,
          domainId: row.domain_id,
          headingPath: row.heading_path,
          content: row.content,
          charCount: row.char_count,
          tokenEstimate: row.token_estimate,
          startLine: row.start_line,
          endLine: row.end_line,
          contentHash: row.content_hash,
          modelName: row.model_name,
          dimensions: row.dimensions,
          embedding: vec,
          providerFingerprint: row.provider_fingerprint,
        })
      }

      return Ok(results)
    } catch (err) {
      return Err(DomainOSError.db(`Failed to get embeddings: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /** Delete all chunks for a KB file (embeddings cascade). */
  deleteByFile(kbFileId: string): Result<number, DomainOSError> {
    try {
      const info = this.db.prepare('DELETE FROM kb_chunks WHERE kb_file_id = ?').run(kbFileId)
      return Ok(info.changes)
    } catch (err) {
      return Err(DomainOSError.db(`Failed to delete chunks by file: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /** Delete all chunks for a domain (embeddings cascade). */
  deleteByDomain(domainId: string): Result<number, DomainOSError> {
    try {
      const info = this.db.prepare('DELETE FROM kb_chunks WHERE domain_id = ?').run(domainId)
      return Ok(info.changes)
    } catch (err) {
      return Err(DomainOSError.db(`Failed to delete chunks by domain: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /** Delete embeddings for a specific model only (chunks preserved). */
  deleteEmbeddingsByModel(domainId: string, modelName: string): Result<number, DomainOSError> {
    try {
      const info = this.db.prepare(`
        DELETE FROM kb_chunk_embeddings WHERE chunk_id IN (
          SELECT id FROM kb_chunks WHERE domain_id = ?
        ) AND model_name = ?
      `).run(domainId, modelName)
      return Ok(info.changes)
    } catch (err) {
      return Err(DomainOSError.db(`Failed to delete embeddings by model: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /** Check if embeddings exist for domain + model (with optional fingerprint match). */
  hasEmbeddings(domainId: string, modelName: string, providerFingerprint?: string): Result<boolean, DomainOSError> {
    try {
      const row = this.db.prepare(`
        SELECT COUNT(*) as count FROM kb_chunk_embeddings e
        JOIN kb_chunks c ON c.id = e.chunk_id
        WHERE c.domain_id = ? AND e.model_name = ?
        ${providerFingerprint ? 'AND e.provider_fingerprint = ?' : ''}
      `).get(...(providerFingerprint
        ? [domainId, modelName, providerFingerprint]
        : [domainId, modelName]
      )) as { count: number }
      return Ok(row.count > 0)
    } catch (err) {
      return Err(DomainOSError.db(`Failed to check embeddings: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /** Get indexing job status for a domain. */
  getJobStatus(domainId: string, modelName?: string): Result<EmbeddingJobStatus | null, DomainOSError> {
    try {
      const query = modelName
        ? 'SELECT * FROM kb_embedding_jobs WHERE domain_id = ? AND model_name = ?'
        : 'SELECT * FROM kb_embedding_jobs WHERE domain_id = ? ORDER BY updated_at DESC LIMIT 1'
      const row = modelName
        ? this.db.prepare(query).get(domainId, modelName) as JobRow | undefined
        : this.db.prepare(query).get(domainId) as JobRow | undefined

      if (!row) return Ok(null)

      return Ok({
        domainId: row.domain_id,
        modelName: row.model_name,
        runId: row.run_id,
        providerFingerprint: row.provider_fingerprint,
        status: row.status as 'idle' | 'running' | 'error',
        totalFiles: row.total_files,
        processedFiles: row.processed_files,
        totalChunks: row.total_chunks,
        embeddedChunks: row.embedded_chunks,
        lastError: row.last_error,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
      })
    } catch (err) {
      return Err(DomainOSError.db(`Failed to get job status: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /** Upsert indexing job status. */
  updateJobStatus(domainId: string, modelName: string, status: Partial<EmbeddingJobStatus>): Result<void, DomainOSError> {
    try {
      const now = new Date().toISOString()
      this.db.prepare(`
        INSERT INTO kb_embedding_jobs (domain_id, model_name, run_id, provider_fingerprint, status, total_files, processed_files, total_chunks, embedded_chunks, last_error, started_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(domain_id, model_name) DO UPDATE SET
          run_id = COALESCE(excluded.run_id, run_id),
          provider_fingerprint = COALESCE(excluded.provider_fingerprint, provider_fingerprint),
          status = excluded.status,
          total_files = excluded.total_files,
          processed_files = excluded.processed_files,
          total_chunks = excluded.total_chunks,
          embedded_chunks = excluded.embedded_chunks,
          last_error = excluded.last_error,
          started_at = COALESCE(excluded.started_at, started_at),
          updated_at = excluded.updated_at
      `).run(
        domainId,
        modelName,
        status.runId ?? null,
        status.providerFingerprint ?? '',
        status.status ?? 'idle',
        status.totalFiles ?? 0,
        status.processedFiles ?? 0,
        status.totalChunks ?? 0,
        status.embeddedChunks ?? 0,
        status.lastError ?? null,
        status.startedAt ?? null,
        now,
      )
      return Ok(undefined)
    } catch (err) {
      return Err(DomainOSError.db(`Failed to update job status: ${err instanceof Error ? err.message : String(err)}`))
    }
  }
}
