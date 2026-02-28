import type { PluginData, PluginSourceType, MarketplaceEntryData } from '../../preload/api'

// ── Trust badge ──

const TRUST_BADGE: Record<PluginSourceType, { label: string; className: string }> = {
  anthropic_official: { label: 'Official', className: 'bg-green-500/15 text-green-400' },
  github_repo: { label: 'Community', className: 'bg-blue-500/15 text-blue-400' },
  local_directory: { label: 'Local', className: 'bg-gray-500/15 text-gray-400' },
}

function TrustBadge({ sourceType }: { sourceType: PluginSourceType }) {
  const badge = TRUST_BADGE[sourceType] ?? TRUST_BADGE.local_directory
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
      {badge.label}
    </span>
  )
}

function MarketplaceTrustBadge({ trusted }: { trusted: boolean }) {
  if (trusted) {
    return (
      <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
        Official
      </span>
    )
  }
  return (
    <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
      Community
    </span>
  )
}

// ── Installed plugin card ──

interface InstalledCardProps {
  plugin: PluginData
  onClick: () => void
  onToggle: () => void
}

export function InstalledPluginCard({ plugin, onClick, onToggle }: InstalledCardProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2.5 cursor-pointer transition-colors hover:border-accent/30"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${plugin.isEnabled ? 'text-text-primary' : 'text-text-tertiary'}`}>
            {plugin.name}
          </span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-tertiary">
            v{plugin.version}
          </span>
          <TrustBadge sourceType={plugin.sourceType} />
        </div>
        {plugin.description && (
          <p className="mt-0.5 text-xs text-text-tertiary truncate">{plugin.description}</p>
        )}
        {plugin.authorName && (
          <p className="mt-0.5 text-[10px] text-text-tertiary">by {plugin.authorName}</p>
        )}
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
          plugin.isEnabled
            ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
            : 'bg-surface-2 text-text-tertiary hover:bg-surface-2/80'
        }`}
        title={plugin.isEnabled ? 'Disable' : 'Enable'}
      >
        {plugin.isEnabled ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}

// ── Marketplace card ──

interface MarketplaceCardProps {
  entry: MarketplaceEntryData
  onClick: () => void
}

export function MarketplacePluginCard({ entry, onClick }: MarketplaceCardProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2.5 cursor-pointer transition-colors hover:border-accent/30"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{entry.name}</span>
          {entry.version && (
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-tertiary">
              v{entry.version}
            </span>
          )}
          <MarketplaceTrustBadge trusted={entry.source.trusted} />
          {entry.installed && (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
              Installed
            </span>
          )}
          {entry.hasUpdate && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
              Update
            </span>
          )}
        </div>
        {entry.description && (
          <p className="mt-0.5 text-xs text-text-tertiary truncate">{entry.description}</p>
        )}
        <p className="mt-0.5 text-[10px] text-text-tertiary">{entry.source.repo}</p>
      </div>
    </div>
  )
}
