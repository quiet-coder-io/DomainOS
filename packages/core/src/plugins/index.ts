/**
 * Plugins — marketplace integration, command system, and plugin lifecycle management.
 */

export { PluginRepository } from './repository.js'
export type { CreatePluginInput, UpdatePluginInput } from './repository.js'

export { CommandRepository } from './command-repository.js'

export {
  PluginManifestSchema,
  InstalledPluginSchema,
  PluginSourceTypeSchema,
  DiscoveryModeSchema,
  FileManifestEntrySchema,
  AssetIndexEntrySchema,
  PluginDependencySchema,
  PluginDomainAssocSchema,
  CommandSchema,
  CreateCommandInputSchema,
  CommandInvocationSchema,
  MarketplaceSourceSchema,
  DEFAULT_MARKETPLACE_SOURCES,
  TRUSTED_REPOS,
  EXTRACTION_LIMITS,
} from './schemas.js'
export type {
  PluginManifest,
  InstalledPlugin,
  PluginSourceType,
  DiscoveryMode,
  FileManifestEntry,
  AssetIndexEntry,
  PluginDependency,
  PluginDomainAssoc,
  MissingDep,
  DependencyCheckResult,
  Command,
  CreateCommandInput,
  CommandInvocation,
  MarketplaceSource,
  InstallPluginInput,
  InstallPluginResult,
  UpdatePluginResult,
} from './schemas.js'

export { parsePluginSkill } from './skill-bridge.js'
export type { ParsedPluginSkill } from './skill-bridge.js'

export { parsePluginCommand } from './command-bridge.js'
export type { ParsedPluginCommand } from './command-bridge.js'

export { checkDependencies, checkCommandDependencies } from './dependencies.js'

export { MarketplaceCache, fetchPluginList, fetchPluginManifest, listMarketplace } from './marketplace.js'
export type { MarketplaceEntry } from './marketplace.js'

export { installPlugin, cleanupStaging } from './installer.js'
