/**
 * Atomic plugin installer with extraction safety.
 *
 * Flow: stage → safety checks → validate → compute hashes → DB transaction → finalize
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat, mkdir, cp, rm, rename, lstat } from 'node:fs/promises'
import { join, extname, resolve, relative, basename } from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { PluginManifestSchema } from './schemas.js'
import type {
  PluginManifest,
  FileManifestEntry,
  PluginSourceType,
  InstallPluginResult,
} from './schemas.js'
import { EXTRACTION_LIMITS } from './schemas.js'
import { PluginRepository } from './repository.js'
import { CommandRepository } from './command-repository.js'
import { parsePluginSkill } from './skill-bridge.js'
import type { ParsedPluginSkill } from './skill-bridge.js'
import { parsePluginCommand } from './command-bridge.js'
import type { ParsedPluginCommand } from './command-bridge.js'
import { checkDependencies } from './dependencies.js'

// ── Helpers ──

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

// ── Extraction safety ──

interface SafetyCheckResult {
  ok: boolean
  error?: string
}

async function checkExtractionSafety(dir: string): Promise<SafetyCheckResult> {
  let fileCount = 0
  let totalSize = 0

  async function walk(current: string): Promise<SafetyCheckResult> {
    const entries = await readdir(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      const rel = relative(dir, fullPath)

      // Block path traversal
      if (rel.startsWith('..') || rel.includes('/../') || resolve(fullPath) !== fullPath) {
        return { ok: false, error: `Path traversal detected: ${rel}` }
      }

      // Block symlinks
      const lstats = await lstat(fullPath)
      if (lstats.isSymbolicLink()) {
        return { ok: false, error: `Symlink detected: ${rel}` }
      }

      if (lstats.isDirectory()) {
        const subResult = await walk(fullPath)
        if (!subResult.ok) return subResult
        continue
      }

      if (lstats.isFile()) {
        fileCount++
        totalSize += lstats.size

        // File count limit
        if (fileCount > EXTRACTION_LIMITS.maxFileCount) {
          return { ok: false, error: `File count exceeds ${EXTRACTION_LIMITS.maxFileCount}` }
        }

        // Single file size limit
        if (lstats.size > EXTRACTION_LIMITS.maxSingleFileBytes) {
          return { ok: false, error: `File too large (${lstats.size} bytes): ${rel}` }
        }

        // Total size limit
        if (totalSize > EXTRACTION_LIMITS.maxTotalBytes) {
          return { ok: false, error: `Total size exceeds ${EXTRACTION_LIMITS.maxTotalBytes} bytes` }
        }

        // Check file extension (only storage-allowed types)
        const ext = extname(entry.name).toLowerCase()
        if (ext && !EXTRACTION_LIMITS.storageAllowedExts.has(ext)) {
          // Special case: plugin.json and LICENSE/NOTICE files are always allowed
          const name = entry.name.toLowerCase()
          if (name !== 'plugin.json' && name !== 'license' && name !== 'notice') {
            return { ok: false, error: `Disallowed file type (${ext}): ${rel}` }
          }
        }
      }
    }

    return { ok: true }
  }

  return walk(dir)
}

// ── File manifest builder ──

async function buildFileManifest(dir: string): Promise<FileManifestEntry[]> {
  const manifest: FileManifestEntry[] = []

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const fileBuffer = await readFile(fullPath)
        const fileStat = await stat(fullPath)
        manifest.push({
          path: relative(dir, fullPath),
          sha256: sha256(fileBuffer),
          size: fileStat.size,
        })
      }
    }
  }

  await walk(dir)
  return manifest.sort((a, b) => a.path.localeCompare(b.path))
}

// ── Discover components ──

interface DiscoveredComponents {
  skillDirs: string[]
  commandFiles: string[]
  discoveryMode: 'manifest' | 'scan_fallback'
}

async function discoverComponents(
  dir: string,
  manifest: PluginManifest,
): Promise<DiscoveredComponents> {
  const skillDirs: string[] = []
  const commandFiles: string[] = []

  // Check manifest-declared paths first
  if (manifest.skills && manifest.skills.length > 0) {
    for (const skillPath of manifest.skills) {
      const fullPath = join(dir, skillPath)
      try {
        const s = await stat(fullPath)
        if (s.isDirectory()) skillDirs.push(fullPath)
      } catch { /* skip missing */ }
    }
  }

  if (manifest.commands && manifest.commands.length > 0) {
    for (const cmdPath of manifest.commands) {
      const fullPath = join(dir, cmdPath)
      try {
        const s = await stat(fullPath)
        if (s.isFile()) commandFiles.push(fullPath)
      } catch { /* skip missing */ }
    }
  }

  if (skillDirs.length > 0 || commandFiles.length > 0) {
    return { skillDirs, commandFiles, discoveryMode: 'manifest' }
  }

  // Fallback: scan skills/ and commands/ directories
  const skillsDir = join(dir, 'skills')
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = join(skillsDir, entry.name, 'SKILL.md')
        try {
          await stat(skillMdPath)
          skillDirs.push(join(skillsDir, entry.name))
        } catch { /* no SKILL.md */ }
      }
    }
  } catch { /* no skills/ directory */ }

  const commandsDir = join(dir, 'commands')
  try {
    const entries = await readdir(commandsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        commandFiles.push(join(commandsDir, entry.name))
      }
    }
  } catch { /* no commands/ directory */ }

  return { skillDirs, commandFiles, discoveryMode: 'scan_fallback' }
}

// ── Main installer ──

export async function installPlugin(
  sourcePath: string,
  db: Database.Database,
  pluginsDir: string,
  opts?: {
    sourceType?: PluginSourceType
    sourceRepo?: string
    sourceRef?: string
  },
): Promise<Result<InstallPluginResult, DomainOSError>> {
  const stagingId = uuidv4()
  const stagingDir = join(pluginsDir, '.staging', stagingId)
  const warnings: string[] = []

  try {
    // 1. STAGE: copy to staging
    await mkdir(stagingDir, { recursive: true })
    await cp(sourcePath, stagingDir, { recursive: true })

    // 2. EXTRACTION SAFETY
    const safety = await checkExtractionSafety(stagingDir)
    if (!safety.ok) {
      await rm(stagingDir, { recursive: true, force: true })
      return Err(DomainOSError.validation(`Extraction safety check failed: ${safety.error}`))
    }

    // 3. VALIDATE: parse plugin.json (check root, then .claude-plugin/)
    let manifestPath = join(stagingDir, 'plugin.json')
    let manifestRaw: string
    try {
      manifestRaw = await readFile(manifestPath, 'utf-8')
    } catch {
      // Fallback: Anthropic repos nest manifest inside .claude-plugin/
      try {
        const altPath = join(stagingDir, '.claude-plugin', 'plugin.json')
        manifestRaw = await readFile(altPath, 'utf-8')
        manifestPath = altPath
      } catch {
        await rm(stagingDir, { recursive: true, force: true })
        return Err(DomainOSError.validation('Missing plugin.json (checked root and .claude-plugin/)'))
      }
    }

    let manifestParsed: PluginManifest
    try {
      const json = JSON.parse(manifestRaw)
      const parsed = PluginManifestSchema.safeParse(json)
      if (!parsed.success) {
        await rm(stagingDir, { recursive: true, force: true })
        return Err(DomainOSError.validation(`Invalid plugin.json: ${parsed.error.message}`))
      }
      manifestParsed = parsed.data
    } catch (e) {
      await rm(stagingDir, { recursive: true, force: true })
      return Err(DomainOSError.validation(`Failed to parse plugin.json: ${(e as Error).message}`))
    }

    // Check if already installed
    const existingRow = db
      .prepare('SELECT id FROM plugins WHERE name = ? COLLATE NOCASE')
      .get(manifestParsed.name) as { id: string } | undefined
    if (existingRow) {
      await rm(stagingDir, { recursive: true, force: true })
      return Err(DomainOSError.validation(`Plugin "${manifestParsed.name}" is already installed`))
    }

    // 4. COMPUTE hashes and discover components
    const manifestHash = sha256(manifestRaw)
    const fileManifest = await buildFileManifest(stagingDir)
    const components = await discoverComponents(stagingDir, manifestParsed)

    // Read LICENSE/NOTICE
    let licenseText: string | null = null
    let noticeText: string | null = null
    try { licenseText = await readFile(join(stagingDir, 'LICENSE'), 'utf-8') } catch { /* ok */ }
    try { noticeText = await readFile(join(stagingDir, 'NOTICE'), 'utf-8') } catch { /* ok */ }

    // Parse skills
    const parsedSkills: ParsedPluginSkill[] = []
    for (const skillDir of components.skillDirs) {
      try {
        const skill = await parsePluginSkill(skillDir, {
          sourceRef: opts?.sourceRef,
          sourcePath: `skills/${basename(skillDir)}/SKILL.md`,
        })
        parsedSkills.push(skill)
      } catch (e) {
        warnings.push(`Skipped skill in ${basename(skillDir)}: ${(e as Error).message}`)
      }
    }

    // Parse commands
    const parsedCommands: ParsedPluginCommand[] = []
    for (const cmdFile of components.commandFiles) {
      try {
        const rawContent = await readFile(cmdFile, 'utf-8')
        const cmd = parsePluginCommand(cmdFile, rawContent, {
          pluginName: manifestParsed.name,
          sourceRef: opts?.sourceRef,
          sourcePath: `commands/${basename(cmdFile)}`,
        })
        parsedCommands.push(cmd)
      } catch (e) {
        warnings.push(`Skipped command ${basename(cmdFile)}: ${(e as Error).message}`)
      }
    }

    // 5. CHECK DEPENDENCIES
    const sourceRepo = opts?.sourceRepo ?? null
    if (sourceRepo) {
      const depResult = checkDependencies(manifestParsed.name, sourceRepo, db)
      for (const dep of depResult.hard) {
        warnings.push(`Hard dependency: "${dep.name}" is not installed`)
      }
      for (const dep of depResult.soft) {
        warnings.push(`Soft dependency: "${dep.name}" is not installed`)
      }
    }

    // Resolve author
    const authorName = typeof manifestParsed.author === 'string'
      ? manifestParsed.author
      : manifestParsed.author?.name ?? ''
    const authorJson = manifestParsed.author
      ? JSON.stringify(manifestParsed.author)
      : null

    // 6. SINGLE DB TRANSACTION
    const pluginRepo = new PluginRepository(db)
    const commandRepo = new CommandRepository(db)
    const finalInstallPath = join(pluginsDir, manifestParsed.name)

    const txn = db.transaction(() => {
      // Insert plugin
      const pluginResult = pluginRepo.create({
        name: manifestParsed.name,
        version: manifestParsed.version ?? '0.0.0',
        description: manifestParsed.description ?? '',
        authorName,
        authorJson,
        sourceType: opts?.sourceType ?? 'local_directory',
        sourceRepo,
        sourceRef: opts?.sourceRef ?? null,
        manifestJson: manifestRaw,
        manifestHash,
        fileManifestJson: JSON.stringify(fileManifest),
        installPath: finalInstallPath,
        licenseText,
        noticeText,
        discoveryMode: components.discoveryMode,
      })

      if (!pluginResult.ok) throw new Error(pluginResult.error.message)
      const plugin = pluginResult.value

      // Insert skills
      let skillsImported = 0
      for (const skill of parsedSkills) {
        db.prepare(
          `INSERT INTO skills (id, name, description, content, output_format, output_schema,
             tool_hints, is_enabled, sort_order, created_at, updated_at,
             plugin_id, plugin_skill_key, source_content, source_hash,
             source_ref, source_path, has_assets, assets_index_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          uuidv4(),
          skill.name,
          skill.description,
          skill.content,
          skill.outputFormat,
          skill.outputSchema,
          JSON.stringify(skill.toolHints),
          1, // enabled by default
          0,
          new Date().toISOString(),
          new Date().toISOString(),
          plugin.id,
          skill.pluginSkillKey,
          skill.sourceContent,
          skill.sourceHash,
          skill.sourceRef,
          skill.sourcePath,
          skill.hasAssets ? 1 : 0,
          skill.assetsIndexJson.length > 0 ? JSON.stringify(skill.assetsIndexJson) : null,
        )
        skillsImported++
      }

      // Insert commands
      let commandsImported = 0
      for (const cmd of parsedCommands) {
        commandRepo.create({
          pluginId: plugin.id,
          pluginCommandKey: cmd.pluginCommandKey,
          name: cmd.name,
          canonicalSlug: cmd.canonicalSlug,
          pluginName: manifestParsed.name,
          description: cmd.description,
          argumentHint: cmd.argumentHint,
          sourceContent: cmd.sourceContent,
          content: cmd.content,
          sourceHash: cmd.sourceHash,
          sourceRef: cmd.sourceRef,
          sourcePath: cmd.sourcePath,
          isEnabled: true,
          sortOrder: 0,
        })
        commandsImported++
      }

      return { plugin, skillsImported, commandsImported }
    })

    let result: { plugin: any; skillsImported: number; commandsImported: number }
    try {
      result = txn()
    } catch (e) {
      await rm(stagingDir, { recursive: true, force: true })
      return Err(DomainOSError.db(`Install transaction failed: ${(e as Error).message}`))
    }

    // 7. FINALIZE: move staging to final location
    try {
      await mkdir(pluginsDir, { recursive: true })
      await rename(stagingDir, finalInstallPath)
    } catch (e) {
      // Rollback: remove the DB rows
      db.prepare('DELETE FROM plugins WHERE id = ?').run(result.plugin.id)
      await rm(stagingDir, { recursive: true, force: true })
      return Err(DomainOSError.io(`Failed to finalize install: ${(e as Error).message}`))
    }

    return Ok({
      plugin: result.plugin,
      skillsImported: result.skillsImported,
      commandsImported: result.commandsImported,
      warnings,
    })
  } catch (e) {
    // Cleanup staging on any unexpected error
    try { await rm(stagingDir, { recursive: true, force: true }) } catch { /* ignore */ }
    return Err(DomainOSError.io(`Unexpected install error: ${(e as Error).message}`))
  }
}

/** Clean up any interrupted installs — call on app startup. */
export async function cleanupStaging(pluginsDir: string): Promise<void> {
  try {
    const staging = join(pluginsDir, '.staging')
    await rm(staging, { recursive: true, force: true })
  } catch {
    // Staging dir doesn't exist — nothing to clean
  }
}
