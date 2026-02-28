/**
 * Source-aware dependency checker for plugins.
 *
 * Dependencies are scoped by source_repo — a plugin from repo A
 * can only satisfy a dependency declared in repo A.
 */

import type Database from 'better-sqlite3'
import type { MissingDep, DependencyCheckResult } from './schemas.js'

interface DepRow {
  depends_on_name: string
  dep_type: 'soft' | 'hard'
}

interface PluginRow {
  id: string
  name: string
  source_repo: string | null
}

interface AssocRow {
  is_enabled: number
}

interface CommandRow {
  plugin_id: string | null
  plugin_name: string | null
}

/**
 * Check whether all dependencies for a plugin are satisfied.
 *
 * Source-aware: only plugins from the same source_repo can satisfy a dep.
 * When domainId is provided, also checks that the dep plugin is enabled
 * for that specific domain.
 */
export function checkDependencies(
  pluginName: string,
  sourceRepo: string,
  db: Database.Database,
  domainId?: string,
): DependencyCheckResult {
  const deps = db
    .prepare(
      `SELECT depends_on_name, dep_type FROM plugin_dependencies
       WHERE source_repo = ? AND plugin_name = ?`,
    )
    .all(sourceRepo, pluginName) as DepRow[]

  const hard: MissingDep[] = []
  const soft: MissingDep[] = []

  for (const dep of deps) {
    // Check if the dependency plugin is installed from the same source
    const installed = db
      .prepare(
        `SELECT id, name, source_repo FROM plugins
         WHERE name = ? AND source_repo = ?`,
      )
      .get(dep.depends_on_name, sourceRepo) as PluginRow | undefined

    const installedGlobally = !!installed

    let enabledForDomain = false
    if (installed && domainId) {
      const assoc = db
        .prepare(
          `SELECT is_enabled FROM plugin_domain_assoc
           WHERE plugin_id = ? AND domain_id = ?`,
        )
        .get(installed.id, domainId) as AssocRow | undefined

      enabledForDomain = assoc?.is_enabled === 1
    }

    // Only add to missing list if the dep is NOT fully satisfied
    const satisfied = domainId
      ? installedGlobally && enabledForDomain
      : installedGlobally

    if (!satisfied) {
      const entry: MissingDep = {
        name: dep.depends_on_name,
        depType: dep.dep_type,
        installedGlobally,
        enabledForDomain,
      }

      if (dep.dep_type === 'hard') {
        hard.push(entry)
      } else {
        soft.push(entry)
      }
    }
  }

  return { hard, soft }
}

/**
 * Check whether a command's plugin has all hard dependencies satisfied
 * for a given domain. Used to gate command invocation.
 */
export function checkCommandDependencies(
  canonicalSlug: string,
  domainId: string,
  db: Database.Database,
): { blocked: boolean; reason?: string; missingDep?: string } {
  // Look up the command to find its plugin
  const cmd = db
    .prepare(
      `SELECT plugin_id, plugin_name FROM commands WHERE canonical_slug = ?`,
    )
    .get(canonicalSlug) as CommandRow | undefined

  if (!cmd || !cmd.plugin_id) {
    // Built-in command or not found — not blocked
    return { blocked: false }
  }

  // Find the plugin's source_repo
  const plugin = db
    .prepare(`SELECT id, name, source_repo FROM plugins WHERE id = ?`)
    .get(cmd.plugin_id) as PluginRow | undefined

  if (!plugin || !plugin.source_repo) {
    // Local plugin with no source repo — no dep tracking
    return { blocked: false }
  }

  const result = checkDependencies(
    plugin.name,
    plugin.source_repo,
    db,
    domainId,
  )

  if (result.hard.length > 0) {
    const first = result.hard[0]!
    return {
      blocked: true,
      reason: `Plugin "${plugin.name}" requires "${first.name}" (hard dependency)`,
      missingDep: first.name,
    }
  }

  return { blocked: false }
}
