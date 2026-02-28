/**
 * Zod schemas for the plugin system — matching official Claude plugin spec.
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

// ── Plugin Manifest (official spec shape) ──

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  description: z.string().default(''),
  author: z.union([
    z.string(),
    z.object({ name: z.string() }).passthrough(),
  ]).optional(),
  // Optional component path declarations
  skills: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  hooks: z.record(z.unknown()).optional(),
  mcpServers: z.record(z.unknown()).optional(),
}).passthrough()  // accept unknown fields for forward compat

export type PluginManifest = z.infer<typeof PluginManifestSchema>

// ── Source type ──

export const PluginSourceTypeSchema = z.enum(['anthropic_official', 'github_repo', 'local_directory'])
export type PluginSourceType = z.infer<typeof PluginSourceTypeSchema>

export const DiscoveryModeSchema = z.enum(['manifest', 'scan_fallback'])
export type DiscoveryMode = z.infer<typeof DiscoveryModeSchema>

// ── File manifest entry ──

export const FileManifestEntrySchema = z.object({
  path: z.string(),
  sha256: z.string(),
  size: z.number().int().nonnegative(),
})
export type FileManifestEntry = z.infer<typeof FileManifestEntrySchema>

// ── Asset index entry (per-skill) ──

export const AssetIndexEntrySchema = z.object({
  path: z.string(),
  sha256: z.string(),
  size: z.number().int().nonnegative(),
  type: z.string(),
  llm_safe: z.union([z.literal(0), z.literal(1)]),
})
export type AssetIndexEntry = z.infer<typeof AssetIndexEntrySchema>

// ── Installed plugin (DB row representation) ──

export const InstalledPluginSchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  version: z.string(),
  description: z.string(),
  authorName: z.string(),
  authorJson: z.string().nullable(),
  sourceType: PluginSourceTypeSchema,
  sourceRepo: z.string().nullable(),
  sourceRef: z.string().nullable(),
  sourcePath: z.string().nullable(),
  manifestJson: z.string(),
  manifestHash: z.string(),
  fileManifestJson: z.string().nullable(),
  installPath: z.string(),
  connectorJson: z.string().nullable(),
  licenseText: z.string().nullable(),
  noticeText: z.string().nullable(),
  discoveryMode: DiscoveryModeSchema,
  strictMode: z.boolean(),
  formatVersion: z.number().int(),
  isEnabled: z.boolean(),
  installedAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type InstalledPlugin = z.infer<typeof InstalledPluginSchema>

// ── Plugin dependency ──

export const PluginDependencySchema = z.object({
  sourceRepo: z.string(),
  pluginName: z.string(),
  dependsOnName: z.string(),
  depType: z.enum(['soft', 'hard']),
})

export type PluginDependency = z.infer<typeof PluginDependencySchema>

// ── Plugin domain association ──

export const PluginDomainAssocSchema = z.object({
  pluginId: UUIDSchema,
  domainId: UUIDSchema,
  isEnabled: z.boolean(),
  createdAt: TimestampSchema,
})

export type PluginDomainAssoc = z.infer<typeof PluginDomainAssocSchema>

// ── Missing dependency result ──

export interface MissingDep {
  name: string
  depType: 'soft' | 'hard'
  installedGlobally: boolean
  enabledForDomain: boolean
}

export interface DependencyCheckResult {
  hard: MissingDep[]
  soft: MissingDep[]
}

// ── Command schemas ──

export const CommandSchema = z.object({
  id: UUIDSchema,
  pluginId: z.string().nullable(),
  pluginCommandKey: z.string().nullable(),
  name: z.string(),
  canonicalSlug: z.string(),
  pluginName: z.string().nullable(),
  description: z.string(),
  argumentHint: z.string().nullable(),
  sourceContent: z.string(),
  content: z.string(),
  sourceHash: z.string(),
  sourceRef: z.string().nullable(),
  sourcePath: z.string().nullable(),
  removedUpstreamAt: z.string().nullable(),
  isEnabled: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Command = z.infer<typeof CommandSchema>

export const CreateCommandInputSchema = z.object({
  pluginId: z.string(),
  pluginCommandKey: z.string(),
  name: z.string().min(1, 'Command name is required'),
  canonicalSlug: z.string().min(1),
  pluginName: z.string().nullable().default(null),
  description: z.string().default(''),
  argumentHint: z.string().nullable().default(null),
  sourceContent: z.string().min(1),
  content: z.string().min(1),
  sourceHash: z.string(),
  sourceRef: z.string().nullable().default(null),
  sourcePath: z.string().nullable().default(null),
  isEnabled: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
})

export type CreateCommandInput = z.infer<typeof CreateCommandInputSchema>

// ── Command invocation audit ──

export const CommandInvocationSchema = z.object({
  id: UUIDSchema,
  commandId: z.string(),
  domainId: z.string(),
  canonicalSlug: z.string(),
  pluginVersion: z.string().nullable(),
  argsHash: z.string().nullable(),
  resultHash: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  status: z.enum(['success', 'blocked', 'error']),
  errorCode: z.string().nullable(),
  invokedAt: TimestampSchema,
})

export type CommandInvocation = z.infer<typeof CommandInvocationSchema>

// ── Marketplace ──

export const MarketplaceSourceSchema = z.object({
  repo: z.string(),
  branch: z.string().default('main'),
  trusted: z.boolean().default(false),
})

export type MarketplaceSource = z.infer<typeof MarketplaceSourceSchema>

export const DEFAULT_MARKETPLACE_SOURCES: MarketplaceSource[] = [
  { repo: 'anthropics/knowledge-work-plugins', branch: 'main', trusted: true },
  { repo: 'anthropics/financial-services-plugins', branch: 'main', trusted: true },
]

export const TRUSTED_REPOS = new Set([
  'anthropics/knowledge-work-plugins',
  'anthropics/financial-services-plugins',
])

// ── Extraction safety constants ──

export const EXTRACTION_LIMITS = {
  maxSingleFileBytes: 1 * 1024 * 1024,   // 1MB per file
  maxTotalBytes: 50 * 1024 * 1024,        // 50MB total
  maxFileCount: 500,
  maxDecompressionRatio: 100,
  storageAllowedExts: new Set(['.md', '.txt', '.json', '.png', '.jpg', '.svg']),
  llmSafeExts: new Set(['.md', '.txt', '.json']),
} as const

// ── Install input ──

export interface InstallPluginInput {
  sourcePath: string
  sourceType: PluginSourceType
  sourceRepo?: string
  sourceRef?: string
}

export interface InstallPluginResult {
  plugin: InstalledPlugin
  skillsImported: number
  commandsImported: number
  warnings: string[]
}

export interface UpdatePluginResult {
  plugin: InstalledPlugin
  skillsAdded: number
  skillsUpdated: number
  skillsRemovedUpstream: number
  commandsAdded: number
  commandsUpdated: number
  commandsRemovedUpstream: number
  conflicts: Array<{
    type: 'skill' | 'command'
    name: string
    reason: 'modified_locally'
  }>
}
