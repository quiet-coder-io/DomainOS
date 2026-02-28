/**
 * Multi-source GitHub API fetcher with caching for the plugin marketplace.
 *
 * Fetches plugin listings from GitHub repositories, caches responses with
 * ETag-based revalidation, and aggregates across configured sources.
 */

import type Database from 'better-sqlite3'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { DEFAULT_MARKETPLACE_SOURCES } from './schemas.js'
import type { MarketplaceSource, PluginManifest } from './schemas.js'
import { PluginManifestSchema } from './schemas.js'

// ── Types ──

export interface MarketplaceEntry {
  name: string
  source: MarketplaceSource
  description?: string
  version?: string
  installed: boolean
  hasUpdate: boolean
}

interface CacheRow {
  repo: string
  ref: string
  etag: string | null
  last_status_code: number | null
  response_json: string
  fetched_at: string
}

interface GitHubContentItem {
  name: string
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  path: string
}

interface InstalledRow {
  name: string
  version: string
  source_repo: string | null
}

type FetchFn = typeof globalThis.fetch

// ── Cache ──

export class MarketplaceCache {
  constructor(private db: Database.Database) {}

  get(repo: string): CacheRow | null {
    const row = this.db
      .prepare(`SELECT * FROM marketplace_cache WHERE repo = ?`)
      .get(repo) as CacheRow | undefined

    return row ?? null
  }

  set(repo: string, data: Omit<CacheRow, 'repo'>): void {
    this.db
      .prepare(
        `INSERT INTO marketplace_cache (repo, ref, etag, last_status_code, response_json, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo) DO UPDATE SET
           ref = excluded.ref,
           etag = excluded.etag,
           last_status_code = excluded.last_status_code,
           response_json = excluded.response_json,
           fetched_at = excluded.fetched_at`,
      )
      .run(repo, data.ref, data.etag, data.last_status_code, data.response_json, data.fetched_at)
  }
}

// ── Fetchers ──

/**
 * Fetch the top-level directory listing of a plugin repository.
 * Each subdirectory is a potential plugin.
 */
export async function fetchPluginList(
  source: MarketplaceSource,
  cache: MarketplaceCache,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<Result<GitHubContentItem[], DomainOSError>> {
  const [owner, repo] = source.repo.split('/')
  if (!owner || !repo) {
    return Err(DomainOSError.validation(`Invalid repo format: ${source.repo}`))
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents?ref=${source.branch}`
  const cached = cache.get(source.repo)

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'DomainOS-Marketplace',
  }

  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag
  }

  try {
    const res = await fetchFn(url, { headers })

    // 304 Not Modified — return cached data
    if (res.status === 304 && cached) {
      try {
        return Ok(JSON.parse(cached.response_json) as GitHubContentItem[])
      } catch {
        return Err(DomainOSError.parse('Corrupt cached response'))
      }
    }

    // Rate limited — return stale cache if available
    if (res.status === 403 || res.status === 429) {
      if (cached) {
        try {
          return Ok(JSON.parse(cached.response_json) as GitHubContentItem[])
        } catch {
          return Err(DomainOSError.parse('Corrupt cached response'))
        }
      }
      return Err(DomainOSError.io(`GitHub API rate limited (${res.status})`))
    }

    if (!res.ok) {
      return Err(DomainOSError.io(`GitHub API error: ${res.status} ${res.statusText}`))
    }

    const body = (await res.json()) as GitHubContentItem[]
    const etag = res.headers.get('etag')

    cache.set(source.repo, {
      ref: source.branch,
      etag,
      last_status_code: res.status,
      response_json: JSON.stringify(body),
      fetched_at: new Date().toISOString(),
    })

    return Ok(body)
  } catch (e) {
    // Network error — try stale cache
    if (cached) {
      try {
        return Ok(JSON.parse(cached.response_json) as GitHubContentItem[])
      } catch {
        // Fall through to error
      }
    }
    return Err(DomainOSError.io(`Fetch failed: ${(e as Error).message}`))
  }
}

/**
 * Fetch and parse a single plugin's manifest from its repository.
 */
export async function fetchPluginManifest(
  source: MarketplaceSource,
  pluginName: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<Result<PluginManifest, DomainOSError>> {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.branch}/${pluginName}/plugin.json`

  try {
    const res = await fetchFn(url, {
      headers: { 'User-Agent': 'DomainOS-Marketplace' },
    })

    if (!res.ok) {
      return Err(
        DomainOSError.io(
          `Failed to fetch manifest for "${pluginName}" from ${source.repo}: ${res.status}`,
        ),
      )
    }

    const raw = await res.json()
    const parsed = PluginManifestSchema.safeParse(raw)

    if (!parsed.success) {
      return Err(
        DomainOSError.validation(
          `Invalid manifest for "${pluginName}": ${parsed.error.message}`,
        ),
      )
    }

    return Ok(parsed.data)
  } catch (e) {
    return Err(DomainOSError.io(`Fetch failed: ${(e as Error).message}`))
  }
}

/**
 * List all available plugins across all configured marketplace sources.
 * Compares against locally installed plugins to set installed/hasUpdate flags.
 */
export async function listMarketplace(
  db: Database.Database,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<Result<MarketplaceEntry[], DomainOSError>> {
  const cache = new MarketplaceCache(db)
  const entries: MarketplaceEntry[] = []

  // Load all installed plugins for comparison
  const installedRows = db
    .prepare(`SELECT name, version, source_repo FROM plugins`)
    .all() as InstalledRow[]

  const installedMap = new Map<string, InstalledRow>()
  for (const row of installedRows) {
    // Key by "repo:name" for source-aware lookup
    const key = row.source_repo ? `${row.source_repo}:${row.name}` : row.name
    installedMap.set(key, row)
  }

  for (const source of DEFAULT_MARKETPLACE_SOURCES) {
    const result = await fetchPluginList(source, cache, fetchFn)
    if (!result.ok) {
      // Skip failed sources — partial results are better than none
      continue
    }

    // Filter to directories only (each dir is a plugin)
    const dirs = result.value.filter((item) => item.type === 'dir')

    for (const dir of dirs) {
      const lookupKey = `${source.repo}:${dir.name}`
      const local = installedMap.get(lookupKey)

      entries.push({
        name: dir.name,
        source,
        installed: !!local,
        hasUpdate: false, // Will be set after manifest fetch if needed
      })
    }
  }

  return Ok(entries)
}
