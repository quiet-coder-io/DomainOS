/**
 * Plugin repository — CRUD for installed plugins and domain associations.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type {
  InstalledPlugin,
  PluginSourceType,
  DiscoveryMode,
  PluginDomainAssoc,
} from './schemas.js'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

interface PluginRow {
  id: string
  name: string
  version: string
  description: string
  author_name: string
  author_json: string | null
  source_type: string
  source_repo: string | null
  source_ref: string | null
  source_path: string | null
  manifest_json: string
  manifest_hash: string
  file_manifest_json: string | null
  install_path: string
  connector_json: string | null
  license_text: string | null
  notice_text: string | null
  discovery_mode: string
  strict_mode: number
  format_version: number
  is_enabled: number
  installed_at: string
  updated_at: string
}

interface PluginDomainAssocRow {
  plugin_id: string
  domain_id: string
  is_enabled: number
  created_at: string
}

function rowToPlugin(row: PluginRow): InstalledPlugin {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    authorName: row.author_name,
    authorJson: row.author_json,
    sourceType: row.source_type as PluginSourceType,
    sourceRepo: row.source_repo,
    sourceRef: row.source_ref,
    sourcePath: row.source_path,
    manifestJson: row.manifest_json,
    manifestHash: row.manifest_hash,
    fileManifestJson: row.file_manifest_json,
    installPath: row.install_path,
    connectorJson: row.connector_json,
    licenseText: row.license_text,
    noticeText: row.notice_text,
    discoveryMode: row.discovery_mode as DiscoveryMode,
    strictMode: row.strict_mode === 1,
    formatVersion: row.format_version,
    isEnabled: row.is_enabled === 1,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  }
}

function rowToAssoc(row: PluginDomainAssocRow): PluginDomainAssoc {
  return {
    pluginId: row.plugin_id,
    domainId: row.domain_id,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
  }
}

export interface CreatePluginInput {
  name: string
  version: string
  description?: string
  authorName?: string
  authorJson?: string | null
  sourceType: PluginSourceType
  sourceRepo?: string | null
  sourceRef?: string | null
  sourcePath?: string | null
  manifestJson: string
  manifestHash: string
  fileManifestJson?: string | null
  installPath: string
  connectorJson?: string | null
  licenseText?: string | null
  noticeText?: string | null
  discoveryMode?: DiscoveryMode
  strictMode?: boolean
  formatVersion?: number
  isEnabled?: boolean
}

export interface UpdatePluginInput {
  version?: string
  description?: string
  authorName?: string
  authorJson?: string | null
  sourceRepo?: string | null
  sourceRef?: string | null
  sourcePath?: string | null
  manifestJson?: string
  manifestHash?: string
  fileManifestJson?: string | null
  connectorJson?: string | null
  licenseText?: string | null
  noticeText?: string | null
  discoveryMode?: DiscoveryMode
  strictMode?: boolean
  formatVersion?: number
  isEnabled?: boolean
}

export class PluginRepository {
  constructor(private db: Database.Database) {}

  create(input: CreatePluginInput): Result<InstalledPlugin, DomainOSError> {
    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          `INSERT INTO plugins (id, name, version, description, author_name, author_json,
             source_type, source_repo, source_ref, source_path,
             manifest_json, manifest_hash, file_manifest_json, install_path,
             connector_json, license_text, notice_text,
             discovery_mode, strict_mode, format_version, is_enabled,
             installed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.version,
          input.description ?? '',
          input.authorName ?? '',
          input.authorJson ?? null,
          input.sourceType,
          input.sourceRepo ?? null,
          input.sourceRef ?? null,
          input.sourcePath ?? null,
          input.manifestJson,
          input.manifestHash,
          input.fileManifestJson ?? null,
          input.installPath,
          input.connectorJson ?? null,
          input.licenseText ?? null,
          input.noticeText ?? null,
          input.discoveryMode ?? 'scan_fallback',
          input.strictMode === false ? 0 : 1,
          input.formatVersion ?? 1,
          input.isEnabled === false ? 0 : 1,
          now,
          now,
        )

      return Ok({
        id,
        name: input.name,
        version: input.version,
        description: input.description ?? '',
        authorName: input.authorName ?? '',
        authorJson: input.authorJson ?? null,
        sourceType: input.sourceType,
        sourceRepo: input.sourceRepo ?? null,
        sourceRef: input.sourceRef ?? null,
        sourcePath: input.sourcePath ?? null,
        manifestJson: input.manifestJson,
        manifestHash: input.manifestHash,
        fileManifestJson: input.fileManifestJson ?? null,
        installPath: input.installPath,
        connectorJson: input.connectorJson ?? null,
        licenseText: input.licenseText ?? null,
        noticeText: input.noticeText ?? null,
        discoveryMode: input.discoveryMode ?? 'scan_fallback',
        strictMode: input.strictMode !== false,
        formatVersion: input.formatVersion ?? 1,
        isEnabled: input.isEnabled !== false,
        installedAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  list(): Result<InstalledPlugin[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM plugins ORDER BY name ASC')
        .all() as PluginRow[]
      return Ok(rows.map(rowToPlugin))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getById(id: string): Result<InstalledPlugin, DomainOSError> {
    try {
      const row = this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as
        | PluginRow
        | undefined
      if (!row) return Err(DomainOSError.notFound('Plugin', id))
      return Ok(rowToPlugin(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByName(name: string): Result<InstalledPlugin, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM plugins WHERE name = ? COLLATE NOCASE')
        .get(name) as PluginRow | undefined
      if (!row) return Err(DomainOSError.notFound('Plugin', name))
      return Ok(rowToPlugin(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  update(id: string, input: UpdatePluginInput): Result<InstalledPlugin, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as
      | PluginRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Plugin', id))

    const now = new Date().toISOString()

    const version = input.version ?? row.version
    const description = input.description ?? row.description
    const authorName = input.authorName ?? row.author_name
    const authorJson = input.authorJson === undefined ? row.author_json : input.authorJson
    const sourceRepo = input.sourceRepo === undefined ? row.source_repo : input.sourceRepo
    const sourceRef = input.sourceRef === undefined ? row.source_ref : input.sourceRef
    const sourcePath = input.sourcePath === undefined ? row.source_path : input.sourcePath
    const manifestJson = input.manifestJson ?? row.manifest_json
    const manifestHash = input.manifestHash ?? row.manifest_hash
    const fileManifestJson = input.fileManifestJson === undefined ? row.file_manifest_json : input.fileManifestJson
    const connectorJson = input.connectorJson === undefined ? row.connector_json : input.connectorJson
    const licenseText = input.licenseText === undefined ? row.license_text : input.licenseText
    const noticeText = input.noticeText === undefined ? row.notice_text : input.noticeText
    const discoveryMode = input.discoveryMode ?? row.discovery_mode
    const strictMode = input.strictMode === undefined ? row.strict_mode : (input.strictMode ? 1 : 0)
    const formatVersion = input.formatVersion ?? row.format_version
    const isEnabled = input.isEnabled === undefined ? row.is_enabled : (input.isEnabled ? 1 : 0)

    try {
      this.db
        .prepare(
          `UPDATE plugins SET version = ?, description = ?, author_name = ?, author_json = ?,
             source_repo = ?, source_ref = ?, source_path = ?,
             manifest_json = ?, manifest_hash = ?, file_manifest_json = ?,
             connector_json = ?, license_text = ?, notice_text = ?,
             discovery_mode = ?, strict_mode = ?, format_version = ?, is_enabled = ?,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(
          version,
          description,
          authorName,
          authorJson,
          sourceRepo,
          sourceRef,
          sourcePath,
          manifestJson,
          manifestHash,
          fileManifestJson,
          connectorJson,
          licenseText,
          noticeText,
          discoveryMode,
          strictMode,
          formatVersion,
          isEnabled,
          now,
          id,
        )

      return Ok(rowToPlugin({
        ...row,
        version,
        description,
        author_name: authorName,
        author_json: authorJson,
        source_repo: sourceRepo,
        source_ref: sourceRef,
        source_path: sourcePath,
        manifest_json: manifestJson,
        manifest_hash: manifestHash,
        file_manifest_json: fileManifestJson,
        connector_json: connectorJson,
        license_text: licenseText,
        notice_text: noticeText,
        discovery_mode: discoveryMode,
        strict_mode: strictMode,
        format_version: formatVersion,
        is_enabled: isEnabled,
        updated_at: now,
      }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  delete(id: string): Result<void, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as
      | PluginRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Plugin', id))

    try {
      this.db.prepare('DELETE FROM plugins WHERE id = ?').run(id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  toggle(id: string): Result<InstalledPlugin, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as
      | PluginRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Plugin', id))

    const newEnabled = row.is_enabled === 1 ? 0 : 1
    const now = new Date().toISOString()

    try {
      this.db
        .prepare('UPDATE plugins SET is_enabled = ?, updated_at = ? WHERE id = ?')
        .run(newEnabled, now, id)

      return Ok(rowToPlugin({ ...row, is_enabled: newEnabled, updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  enableForDomain(pluginId: string, domainId: string): Result<PluginDomainAssoc, DomainOSError> {
    // Verify plugin exists
    const plugin = this.db.prepare('SELECT id FROM plugins WHERE id = ?').get(pluginId) as
      | { id: string }
      | undefined
    if (!plugin) return Err(DomainOSError.notFound('Plugin', pluginId))

    const now = new Date().toISOString()

    try {
      this.db
        .prepare(
          `INSERT INTO plugin_domain_assoc (plugin_id, domain_id, is_enabled, created_at)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(plugin_id, domain_id) DO UPDATE SET is_enabled = 1`,
        )
        .run(pluginId, domainId, now)

      return Ok({
        pluginId,
        domainId,
        isEnabled: true,
        createdAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  disableForDomain(pluginId: string, domainId: string): Result<PluginDomainAssoc, DomainOSError> {
    const row = this.db
      .prepare('SELECT * FROM plugin_domain_assoc WHERE plugin_id = ? AND domain_id = ?')
      .get(pluginId, domainId) as PluginDomainAssocRow | undefined
    if (!row) return Err(DomainOSError.notFound('PluginDomainAssoc', `${pluginId}:${domainId}`))

    try {
      this.db
        .prepare(
          'UPDATE plugin_domain_assoc SET is_enabled = 0 WHERE plugin_id = ? AND domain_id = ?',
        )
        .run(pluginId, domainId)

      return Ok(rowToAssoc({ ...row, is_enabled: 0 }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listForDomain(domainId: string): Result<InstalledPlugin[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT p.* FROM plugins p
           INNER JOIN plugin_domain_assoc pda ON p.id = pda.plugin_id
           WHERE p.is_enabled = 1
             AND pda.domain_id = ?
             AND pda.is_enabled = 1
           ORDER BY p.name ASC`,
        )
        .all(domainId) as PluginRow[]
      return Ok(rows.map(rowToPlugin))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listDomainAssocs(pluginId: string): Result<PluginDomainAssoc[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM plugin_domain_assoc WHERE plugin_id = ? ORDER BY created_at ASC')
        .all(pluginId) as PluginDomainAssocRow[]
      return Ok(rows.map(rowToAssoc))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  async checkIntegrity(id: string): Promise<Result<boolean, DomainOSError>> {
    const row = this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as
      | PluginRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Plugin', id))

    try {
      const pluginJsonPath = join(row.install_path, 'plugin.json')
      const contents = await readFile(pluginJsonPath, 'utf-8')
      const hash = createHash('sha256').update(contents).digest('hex')
      return Ok(hash === row.manifest_hash)
    } catch (e) {
      return Err(DomainOSError.io(`Failed to read plugin.json for integrity check: ${(e as Error).message}`))
    }
  }
}
