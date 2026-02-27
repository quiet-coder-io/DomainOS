import { describe, it, expect, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { openDatabase } from '../../src/storage/index.js'
import { KBChunkRepository } from '../../src/kb/chunk-repository.js'
import type { KBChunkData } from '../../src/kb/chunker.js'
import type Database from 'better-sqlite3'

describe('KBChunkRepository', () => {
  let repo: KBChunkRepository
  let db: Database.Database
  let domainId: string
  let kbFileId: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new KBChunkRepository(db)

    domainId = uuidv4()
    kbFileId = uuidv4()
    const now = new Date().toISOString()

    db.prepare(
      'INSERT INTO domains (id, name, description, kb_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(domainId, 'Test Domain', '', '/tmp/kb', now, now)

    db.prepare(
      'INSERT INTO kb_files (id, domain_id, relative_path, content_hash, size_bytes, last_synced_at, tier, tier_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(kbFileId, domainId, 'test.md', 'filehash1', 1000, now, 'general', 'inferred')
  })

  function makeChunk(overrides: Partial<KBChunkData> = {}): KBChunkData {
    return {
      chunkIndex: 0,
      chunkKey: 'key-' + uuidv4().slice(0, 8),
      headingPath: '## Section',
      content: 'Test chunk content with enough text.',
      contentHash: 'chunkhash-' + uuidv4().slice(0, 8),
      charCount: 36,
      tokenEstimate: 9,
      startLine: 0,
      endLine: 5,
      ...overrides,
    }
  }

  describe('syncChunks', () => {
    it('inserts new chunks', () => {
      const chunks = [makeChunk({ chunkKey: 'k1' }), makeChunk({ chunkKey: 'k2', chunkIndex: 1 })]
      const result = repo.syncChunks(kbFileId, 'filehash1', chunks)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.insertedIds).toHaveLength(2)
      expect(result.value.updatedIds).toHaveLength(0)
      expect(result.value.unchangedIds).toHaveLength(0)
    })

    it('skips unchanged chunks', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'hash1' })]
      repo.syncChunks(kbFileId, 'filehash1', chunks)

      const result = repo.syncChunks(kbFileId, 'filehash1', chunks)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.insertedIds).toHaveLength(0)
      expect(result.value.updatedIds).toHaveLength(0)
      expect(result.value.unchangedIds).toHaveLength(1)
    })

    it('updates chunks with changed content_hash', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'hash1' })]
      repo.syncChunks(kbFileId, 'filehash1', chunks)

      const updated = [makeChunk({ chunkKey: 'k1', contentHash: 'hash2', content: 'Updated content.' })]
      const result = repo.syncChunks(kbFileId, 'filehash2', updated)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.updatedIds).toHaveLength(1)
    })

    it('deletes removed chunks', () => {
      const chunks = [
        makeChunk({ chunkKey: 'k1', contentHash: 'h1' }),
        makeChunk({ chunkKey: 'k2', contentHash: 'h2', chunkIndex: 1 }),
      ]
      repo.syncChunks(kbFileId, 'filehash1', chunks)

      const reduced = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const result = repo.syncChunks(kbFileId, 'filehash1', reduced)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.unchangedIds).toHaveLength(1)

      // Verify k2 is gone
      const remaining = db.prepare('SELECT chunk_key FROM kb_chunks WHERE kb_file_id = ?').all(kbFileId) as Array<{ chunk_key: string }>
      expect(remaining.map(r => r.chunk_key)).toEqual(['k1'])
    })

    it('reads domain_id from kb_files, not from caller', () => {
      const chunks = [makeChunk({ chunkKey: 'k1' })]
      repo.syncChunks(kbFileId, 'filehash1', chunks)

      const row = db.prepare('SELECT domain_id FROM kb_chunks WHERE kb_file_id = ?').get(kbFileId) as { domain_id: string }
      expect(row.domain_id).toBe(domainId)
    })

    it('returns error for non-existent file', () => {
      const result = repo.syncChunks('nonexistent', 'hash', [makeChunk()])
      expect(result.ok).toBe(false)
    })
  })

  describe('storeEmbeddings / getEmbeddings', () => {
    it('stores and retrieves embeddings', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const syncResult = repo.syncChunks(kbFileId, 'filehash1', chunks)
      if (!syncResult.ok) throw new Error('sync failed')
      const chunkId = syncResult.value.insertedIds[0]

      const storeResult = repo.storeEmbeddings([{
        chunkId,
        modelName: 'test-model',
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        contentHash: 'h1',
        providerFingerprint: 'test:model:v1',
      }])
      expect(storeResult.ok).toBe(true)
      if (!storeResult.ok) return
      expect(storeResult.value).toBe(1)

      const getResult = repo.getEmbeddings(domainId, 'test-model')
      expect(getResult.ok).toBe(true)
      if (!getResult.ok) return
      expect(getResult.value).toHaveLength(1)
      expect(getResult.value[0].chunkId).toBe(chunkId)
      expect(getResult.value[0].embedding.length).toBe(3)
      expect(getResult.value[0].embedding[0]).toBeCloseTo(0.1, 5)
    })

    it('supports multiple models for same chunk', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const syncResult = repo.syncChunks(kbFileId, 'filehash1', chunks)
      if (!syncResult.ok) throw new Error('sync failed')
      const chunkId = syncResult.value.insertedIds[0]

      repo.storeEmbeddings([{
        chunkId,
        modelName: 'model-a',
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        contentHash: 'h1',
        providerFingerprint: 'test:a:v1',
      }])
      repo.storeEmbeddings([{
        chunkId,
        modelName: 'model-b',
        dimensions: 2,
        embedding: [0.5, 0.6],
        contentHash: 'h1',
        providerFingerprint: 'test:b:v1',
      }])

      const resultA = repo.getEmbeddings(domainId, 'model-a')
      const resultB = repo.getEmbeddings(domainId, 'model-b')
      expect(resultA.ok && resultA.value.length).toBe(1)
      expect(resultB.ok && resultB.value.length).toBe(1)
    })

    it('replaces embedding on upsert for same chunk+model', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const syncResult = repo.syncChunks(kbFileId, 'filehash1', chunks)
      if (!syncResult.ok) throw new Error('sync failed')
      const chunkId = syncResult.value.insertedIds[0]

      repo.storeEmbeddings([{
        chunkId,
        modelName: 'test-model',
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        contentHash: 'h1',
        providerFingerprint: 'test:model:v1',
      }])
      repo.storeEmbeddings([{
        chunkId,
        modelName: 'test-model',
        dimensions: 3,
        embedding: [0.9, 0.8, 0.7],
        contentHash: 'h1',
        providerFingerprint: 'test:model:v2',
      }])

      const result = repo.getEmbeddings(domainId, 'test-model')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toHaveLength(1)
      expect(result.value[0].embedding[0]).toBeCloseTo(0.9, 5)
    })
  })

  describe('getChunksNeedingEmbedding', () => {
    it('returns chunks with no embedding', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      repo.syncChunks(kbFileId, 'filehash1', chunks)

      const result = repo.getChunksNeedingEmbedding(domainId, 'test-model')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toHaveLength(1)
    })

    it('returns chunks with content_hash mismatch', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const syncResult = repo.syncChunks(kbFileId, 'filehash1', chunks)
      if (!syncResult.ok) throw new Error('sync failed')
      const chunkId = syncResult.value.insertedIds[0]

      repo.storeEmbeddings([{
        chunkId,
        modelName: 'test-model',
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        contentHash: 'h1',
        providerFingerprint: 'test:model:v1',
      }])

      // Update chunk content
      const updatedChunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h2', content: 'Updated content here.' })]
      repo.syncChunks(kbFileId, 'filehash2', updatedChunks)

      const result = repo.getChunksNeedingEmbedding(domainId, 'test-model')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toHaveLength(1)
    })

    it('returns empty for fully embedded chunks', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const syncResult = repo.syncChunks(kbFileId, 'filehash1', chunks)
      if (!syncResult.ok) throw new Error('sync failed')
      const chunkId = syncResult.value.insertedIds[0]

      repo.storeEmbeddings([{
        chunkId,
        modelName: 'test-model',
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        contentHash: 'h1',
        providerFingerprint: 'test:model:v1',
      }])

      const result = repo.getChunksNeedingEmbedding(domainId, 'test-model')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toHaveLength(0)
    })
  })

  describe('cascade deletes', () => {
    it('deletes embeddings when chunk is deleted', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const syncResult = repo.syncChunks(kbFileId, 'filehash1', chunks)
      if (!syncResult.ok) throw new Error('sync failed')
      const chunkId = syncResult.value.insertedIds[0]

      repo.storeEmbeddings([{
        chunkId,
        modelName: 'test-model',
        dimensions: 3,
        embedding: [0.1, 0.2, 0.3],
        contentHash: 'h1',
        providerFingerprint: 'test:model:v1',
      }])

      // Delete the file → chunks cascade → embeddings cascade
      repo.deleteByFile(kbFileId)

      const embedCount = (db.prepare('SELECT COUNT(*) as c FROM kb_chunk_embeddings').get() as { c: number }).c
      expect(embedCount).toBe(0)
    })
  })

  describe('deleteEmbeddingsByModel', () => {
    it('deletes only embeddings for specified model', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const syncResult = repo.syncChunks(kbFileId, 'filehash1', chunks)
      if (!syncResult.ok) throw new Error('sync failed')
      const chunkId = syncResult.value.insertedIds[0]

      repo.storeEmbeddings([{
        chunkId, modelName: 'model-a', dimensions: 3, embedding: [0.1, 0.2, 0.3], contentHash: 'h1', providerFingerprint: 'a:v1',
      }])
      repo.storeEmbeddings([{
        chunkId, modelName: 'model-b', dimensions: 2, embedding: [0.5, 0.6], contentHash: 'h1', providerFingerprint: 'b:v1',
      }])

      repo.deleteEmbeddingsByModel(domainId, 'model-a')

      const resultA = repo.getEmbeddings(domainId, 'model-a')
      const resultB = repo.getEmbeddings(domainId, 'model-b')
      expect(resultA.ok && resultA.value.length).toBe(0)
      expect(resultB.ok && resultB.value.length).toBe(1)
    })
  })

  describe('hasEmbeddings', () => {
    it('returns false when no embeddings exist', () => {
      const result = repo.hasEmbeddings(domainId, 'test-model')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toBe(false)
    })

    it('returns true when embeddings exist', () => {
      const chunks = [makeChunk({ chunkKey: 'k1', contentHash: 'h1' })]
      const syncResult = repo.syncChunks(kbFileId, 'filehash1', chunks)
      if (!syncResult.ok) throw new Error('sync failed')
      const chunkId = syncResult.value.insertedIds[0]

      repo.storeEmbeddings([{
        chunkId, modelName: 'test-model', dimensions: 3, embedding: [0.1, 0.2, 0.3], contentHash: 'h1', providerFingerprint: 'v1',
      }])

      const result = repo.hasEmbeddings(domainId, 'test-model')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toBe(true)
    })
  })

  describe('job status', () => {
    it('upserts and retrieves job status', () => {
      repo.updateJobStatus(domainId, 'test-model', {
        status: 'running',
        totalFiles: 10,
        processedFiles: 3,
      })

      const result = repo.getJobStatus(domainId, 'test-model')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).not.toBeNull()
      expect(result.value!.status).toBe('running')
      expect(result.value!.totalFiles).toBe(10)
    })

    it('returns null for non-existent job', () => {
      const result = repo.getJobStatus(domainId, 'nonexistent-model')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toBeNull()
    })
  })
})
