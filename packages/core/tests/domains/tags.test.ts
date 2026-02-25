import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { DomainRepository } from '../../src/domains/index.js'
import { DomainTagRepository, normalizeTagValue } from '../../src/domains/tags.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let domainRepo: DomainRepository
let tagRepo: DomainTagRepository

function createDomain(name: string): string {
  const result = domainRepo.create({ name, kbPath: '/tmp/kb' })
  if (!result.ok) throw new Error('setup failed')
  return result.value.id
}

beforeEach(() => {
  db = openDatabase(':memory:')
  domainRepo = new DomainRepository(db)
  tagRepo = new DomainTagRepository(db)
})

describe('normalizeTagValue', () => {
  it('trims whitespace', () => {
    expect(normalizeTagValue('  hello  ')).toEqual({ value: 'hello', valueNorm: 'hello' })
  })

  it('lowercases for valueNorm', () => {
    expect(normalizeTagValue('Pine Terrace')).toEqual({ value: 'Pine Terrace', valueNorm: 'pine terrace' })
  })

  it('collapses internal whitespace in valueNorm', () => {
    expect(normalizeTagValue('Pine   Terrace')).toEqual({ value: 'Pine   Terrace', valueNorm: 'pine terrace' })
  })
})

describe('DomainTagRepository', () => {
  describe('setTags + getByDomain', () => {
    it('stores and retrieves tags', () => {
      const domainId = createDomain('Test')
      tagRepo.setTags(domainId, [
        { key: 'property', value: 'Pine Terrace' },
        { key: 'type', value: 'legal' },
      ])

      const tags = tagRepo.getByDomain(domainId)
      expect(tags).toHaveLength(2)
      expect(tags.map((t) => t.key)).toEqual(['property', 'type'])
      expect(tags.find((t) => t.key === 'property')?.value).toBe('Pine Terrace')
    })

    it('replaces existing tags on subsequent setTags call', () => {
      const domainId = createDomain('Test')
      tagRepo.setTags(domainId, [{ key: 'property', value: 'Old' }])
      tagRepo.setTags(domainId, [{ key: 'property', value: 'New' }])

      const tags = tagRepo.getByDomain(domainId)
      expect(tags).toHaveLength(1)
      expect(tags[0].value).toBe('New')
    })

    it('normalizes key to lowercase', () => {
      const domainId = createDomain('Test')
      tagRepo.setTags(domainId, [{ key: 'Property', value: 'val' }])

      const tags = tagRepo.getByDomain(domainId)
      expect(tags[0].key).toBe('property')
    })

    it('trims value on write', () => {
      const domainId = createDomain('Test')
      tagRepo.setTags(domainId, [{ key: 'property', value: '  Pine Terrace  ' }])

      const tags = tagRepo.getByDomain(domainId)
      expect(tags[0].value).toBe('Pine Terrace')
    })
  })

  describe('case-insensitive dedupe via value_norm', () => {
    it('dedupes by value_norm within a single setTags call', () => {
      const domainId = createDomain('Test')
      tagRepo.setTags(domainId, [
        { key: 'property', value: 'Pine Terrace' },
        { key: 'property', value: 'pine terrace' },
      ])

      const tags = tagRepo.getByDomain(domainId)
      expect(tags).toHaveLength(1)
      expect(tags[0].value).toBe('Pine Terrace') // keeps first casing
    })
  })

  describe('getDistinctValues', () => {
    it('returns distinct values with counts', () => {
      const d1 = createDomain('D1')
      const d2 = createDomain('D2')
      const d3 = createDomain('D3')

      tagRepo.setTags(d1, [{ key: 'property', value: 'Pine Terrace' }])
      tagRepo.setTags(d2, [{ key: 'property', value: 'pine terrace' }]) // same normalized
      tagRepo.setTags(d3, [{ key: 'property', value: 'Dyersdale' }])

      const values = tagRepo.getDistinctValues('property')
      expect(values).toHaveLength(2)

      const dyersdale = values.find((v) => v.value.toLowerCase() === 'dyersdale')
      expect(dyersdale?.count).toBe(1)

      const pt = values.find((v) => v.value.toLowerCase().includes('pine'))
      expect(pt?.count).toBe(2)
    })

    it('respects limit', () => {
      const domainId = createDomain('Test')
      const tags = Array.from({ length: 10 }, (_, i) => ({ key: 'type', value: `val-${i}` }))
      tagRepo.setTags(domainId, tags)

      const values = tagRepo.getDistinctValues('type', { limit: 3 })
      expect(values).toHaveLength(3)
    })

    it('returns empty array for unused key', () => {
      expect(tagRepo.getDistinctValues('nonexistent')).toEqual([])
    })
  })

  describe('getDistinctKeys', () => {
    it('returns all distinct keys in use', () => {
      const d1 = createDomain('D1')
      const d2 = createDomain('D2')
      tagRepo.setTags(d1, [
        { key: 'property', value: 'PT' },
        { key: 'type', value: 'legal' },
      ])
      tagRepo.setTags(d2, [{ key: 'contact', value: 'Greystone' }])

      const keys = tagRepo.getDistinctKeys()
      expect(keys).toEqual(['contact', 'property', 'type'])
    })
  })

  describe('getAllGroupedByDomain', () => {
    it('returns tags grouped by domain ID', () => {
      const d1 = createDomain('D1')
      const d2 = createDomain('D2')
      tagRepo.setTags(d1, [{ key: 'property', value: 'PT' }])
      tagRepo.setTags(d2, [{ key: 'type', value: 'legal' }])

      const grouped = tagRepo.getAllGroupedByDomain()
      expect(Object.keys(grouped)).toHaveLength(2)
      expect(grouped[d1]).toHaveLength(1)
      expect(grouped[d2]).toHaveLength(1)
    })
  })

  describe('findDomainIdsByFilters', () => {
    it('returns null when no active filters', () => {
      expect(tagRepo.findDomainIdsByFilters({})).toBeNull()
      expect(tagRepo.findDomainIdsByFilters({ property: [] })).toBeNull()
    })

    it('OR within key — matches domains with any of the values', () => {
      const d1 = createDomain('D1')
      const d2 = createDomain('D2')
      const d3 = createDomain('D3')

      tagRepo.setTags(d1, [{ key: 'property', value: 'Pine Terrace' }])
      tagRepo.setTags(d2, [{ key: 'property', value: 'Dyersdale' }])
      tagRepo.setTags(d3, [{ key: 'property', value: 'Other' }])

      const result = tagRepo.findDomainIdsByFilters({ property: ['Pine Terrace', 'Dyersdale'] })
      expect(result).toHaveLength(2)
      expect(result).toContain(d1)
      expect(result).toContain(d2)
    })

    it('AND across keys — must match all active keys', () => {
      const d1 = createDomain('D1')
      const d2 = createDomain('D2')

      tagRepo.setTags(d1, [
        { key: 'property', value: 'Pine Terrace' },
        { key: 'type', value: 'legal' },
      ])
      tagRepo.setTags(d2, [
        { key: 'property', value: 'Pine Terrace' },
        { key: 'type', value: 'lender' },
      ])

      const result = tagRepo.findDomainIdsByFilters({
        property: ['Pine Terrace'],
        type: ['legal'],
      })
      expect(result).toHaveLength(1)
      expect(result).toContain(d1)
    })

    it('case-insensitive filter matching', () => {
      const d1 = createDomain('D1')
      tagRepo.setTags(d1, [{ key: 'property', value: 'Pine Terrace' }])

      const result = tagRepo.findDomainIdsByFilters({ property: ['pine terrace'] })
      expect(result).toHaveLength(1)
      expect(result).toContain(d1)
    })

    it('ignores keys with empty value arrays', () => {
      const d1 = createDomain('D1')
      tagRepo.setTags(d1, [{ key: 'property', value: 'PT' }])

      // type has empty array → ignored → effectively just property filter
      const result = tagRepo.findDomainIdsByFilters({ property: ['PT'], type: [] })
      expect(result).toHaveLength(1)
      expect(result).toContain(d1)
    })
  })

  describe('cascade delete', () => {
    it('deletes tags when domain is deleted', () => {
      const domainId = createDomain('Test')
      tagRepo.setTags(domainId, [
        { key: 'property', value: 'PT' },
        { key: 'type', value: 'legal' },
      ])

      expect(tagRepo.getByDomain(domainId)).toHaveLength(2)

      domainRepo.delete(domainId)
      expect(tagRepo.getByDomain(domainId)).toHaveLength(0)
    })
  })

  describe('empty/blank handling', () => {
    it('skips tags with empty key or value', () => {
      const domainId = createDomain('Test')
      tagRepo.setTags(domainId, [
        { key: '', value: 'val' },
        { key: 'property', value: '' },
        { key: 'property', value: '   ' },
        { key: 'type', value: 'legal' },
      ])

      const tags = tagRepo.getByDomain(domainId)
      expect(tags).toHaveLength(1)
      expect(tags[0].key).toBe('type')
    })
  })
})
