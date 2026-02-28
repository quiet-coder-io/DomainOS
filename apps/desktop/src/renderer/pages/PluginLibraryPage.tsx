import { useEffect, useState } from 'react'
import { usePluginStore } from '../stores/plugin-store'
import type { ActiveView } from '../App'
import { InstalledPluginCard, MarketplacePluginCard } from '../components/PluginCard'
import { PluginDetailPanel } from '../components/PluginDetailPanel'
import type { PluginData, MarketplaceEntryData } from '../../preload/api'

interface Props {
  onViewChange: (view: ActiveView) => void
}

type Tab = 'installed' | 'marketplace'
type SelectedItem =
  | { kind: 'installed'; plugin: PluginData }
  | { kind: 'marketplace'; entry: MarketplaceEntryData }

export function PluginLibraryPage({ onViewChange: _onViewChange }: Props) {
  const plugins = usePluginStore((s) => s.plugins)
  const marketplace = usePluginStore((s) => s.marketplace)
  const loading = usePluginStore((s) => s.loading)
  const marketplaceLoading = usePluginStore((s) => s.marketplaceLoading)
  const { fetchPlugins, fetchMarketplace, installFromDirectory, toggle } = usePluginStore.getState()

  const [tab, setTab] = useState<Tab>('installed')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SelectedItem | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    fetchPlugins(true)
    fetchMarketplace()
  }, [])

  // Keep selected item in sync after toggle / uninstall
  useEffect(() => {
    if (selected?.kind === 'installed') {
      const updated = plugins.find((p) => p.id === selected.plugin.id)
      if (updated) {
        setSelected({ kind: 'installed', plugin: updated })
      } else {
        setSelected(null)
      }
    }
  }, [plugins]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleInstallFromFolder() {
    const result = await window.domainOS.dialog.openFolder()
    if (!result.ok || !result.value) return
    setInstallError(null)
    setInstalling(true)
    try {
      const installResult = await window.domainOS.plugin.installFromDirectory(result.value)
      if (installResult.ok) {
        await fetchPlugins(true)
      } else {
        setInstallError(installResult.error ?? 'Install failed')
      }
    } catch (e) {
      setInstallError((e as Error).message)
    } finally {
      setInstalling(false)
    }
  }

  function handleToggle(id: string) {
    toggle(id)
  }

  const query = search.toLowerCase()

  const filteredPlugins = plugins.filter((p) => {
    if (!query) return true
    return p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
  })

  const filteredMarketplace = marketplace.filter((e) => {
    if (!query) return true
    return (
      e.name.toLowerCase().includes(query) ||
      (e.description ?? '').toLowerCase().includes(query)
    )
  })

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 border-b border-border-subtle px-5 py-4">
          <h1 className="text-lg font-semibold text-text-primary">Plugins</h1>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Extend DomainOS with skills and slash commands
          </p>
        </div>

        {/* Tabs + Search */}
        <div className="shrink-0 flex items-center gap-4 border-b border-border-subtle px-5 py-2">
          <div className="flex gap-1">
            {(['installed', 'marketplace'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelected(null) }}
                className={`rounded px-3 py-1 text-xs capitalize transition-colors ${
                  tab === t
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {t}
                {t === 'installed' && plugins.length > 0 && (
                  <span className="ml-1.5 text-[10px] opacity-60">{plugins.length}</span>
                )}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none"
            placeholder={tab === 'installed' ? 'Search installed plugins...' : 'Search marketplace...'}
          />

          {tab === 'installed' && (
            <button
              onClick={handleInstallFromFolder}
              disabled={installing}
              className="shrink-0 rounded border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              {installing ? 'Installing...' : 'Install from folder'}
            </button>
          )}
        </div>

        {/* Install error banner */}
        {installError && (
          <div className="mx-5 mb-2 flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <span className="flex-1">{installError}</span>
            <button onClick={() => setInstallError(null)} className="shrink-0 text-red-400 hover:text-red-300">&times;</button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'installed' && (
            <>
              {loading && plugins.length === 0 ? (
                <p className="text-xs text-text-tertiary">Loading plugins...</p>
              ) : filteredPlugins.length === 0 ? (
                <p className="text-xs text-text-tertiary">
                  {plugins.length === 0
                    ? 'No plugins installed. Browse the Marketplace or install from a folder.'
                    : 'No plugins match your search.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredPlugins.map((plugin) => (
                    <InstalledPluginCard
                      key={plugin.id}
                      plugin={plugin}
                      onClick={() => setSelected({ kind: 'installed', plugin })}
                      onToggle={() => handleToggle(plugin.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'marketplace' && (
            <>
              {marketplaceLoading && marketplace.length === 0 ? (
                <p className="text-xs text-text-tertiary">Loading marketplace...</p>
              ) : filteredMarketplace.length === 0 ? (
                <p className="text-xs text-text-tertiary">
                  {marketplace.length === 0
                    ? 'No marketplace entries available.'
                    : 'No entries match your search.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredMarketplace.map((entry) => (
                    <MarketplacePluginCard
                      key={entry.name}
                      entry={entry}
                      onClick={() => setSelected({ kind: 'marketplace', entry })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <PluginDetailPanel
          item={selected}
          onClose={() => setSelected(null)}
          onToggle={(id) => handleToggle(id)}
          onUninstalled={() => { setSelected(null); fetchPlugins(true) }}
        />
      )}
    </div>
  )
}
