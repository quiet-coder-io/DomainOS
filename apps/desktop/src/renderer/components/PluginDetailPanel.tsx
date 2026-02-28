import { useState, useEffect } from 'react'
import { usePluginStore } from '../stores/plugin-store'
import type {
  PluginData,
  PluginSourceType,
  PluginDetailData,
  PluginSkillSummary,
  PluginCommandSummary,
  MarketplaceEntryData,
} from '../../preload/api'

// ── Types ──

type SelectedItem =
  | { kind: 'installed'; plugin: PluginData }
  | { kind: 'marketplace'; entry: MarketplaceEntryData }

interface Props {
  item: SelectedItem
  onClose: () => void
  onToggle: (id: string) => void
  onUninstalled: () => void
}

// ── Trust badge ──

const SOURCE_LABELS: Record<PluginSourceType, { label: string; className: string }> = {
  anthropic_official: { label: 'Anthropic Official', className: 'text-green-400' },
  github_repo: { label: 'Community (GitHub)', className: 'text-blue-400' },
  local_directory: { label: 'Local Directory', className: 'text-gray-400' },
}

// ── Component ──

export function PluginDetailPanel({ item, onClose, onToggle, onUninstalled }: Props) {
  const { uninstall } = usePluginStore.getState()
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; remoteVersion?: string } | null>(null)
  const [detail, setDetail] = useState<PluginDetailData | null>(null)

  const isInstalled = item.kind === 'installed'
  const plugin = isInstalled ? item.plugin : null

  // Fetch full detail (skills + commands) for installed plugins
  useEffect(() => {
    if (!plugin) {
      setDetail(null)
      return
    }

    window.domainOS.plugin.get(plugin.id).then((res) => {
      if (res.ok && res.value) {
        setDetail(res.value)
      }
    })

    window.domainOS.plugin.checkUpdates(plugin.id).then((res) => {
      if (res.ok && res.value) {
        setUpdateInfo(res.value)
      }
    })
  }, [plugin?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUninstall() {
    if (!plugin) return
    const ok = await uninstall(plugin.id)
    if (ok) {
      onUninstalled()
    }
  }

  const skills = detail?.skills ?? []
  const commands = detail?.commands ?? []

  return (
    <div className="shrink-0 w-80 border-l border-border-subtle bg-surface-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary truncate">
          {isInstalled ? plugin!.name : item.entry.name}
        </h2>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-secondary text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Version + Source */}
        <div className="space-y-2">
          {isInstalled && plugin && (
            <>
              <DetailRow label="Version" value={`v${plugin.version}`} />
              <DetailRow label="Author" value={plugin.authorName || 'Unknown'} />
              <DetailRow
                label="Source"
                value={SOURCE_LABELS[plugin.sourceType]?.label ?? plugin.sourceType}
                valueClassName={SOURCE_LABELS[plugin.sourceType]?.className}
              />
              {plugin.sourceRepo && (
                <DetailRow label="Repository" value={plugin.sourceRepo} />
              )}
              <DetailRow
                label="Installed"
                value={new Date(plugin.installedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              />
            </>
          )}

          {!isInstalled && (
            <>
              {item.entry.version && (
                <DetailRow label="Version" value={`v${item.entry.version}`} />
              )}
              <DetailRow label="Repository" value={item.entry.source.repo} />
              <DetailRow label="Branch" value={item.entry.source.branch} />
              <DetailRow
                label="Trust"
                value={item.entry.source.trusted ? 'Anthropic Official' : 'Community'}
                valueClassName={item.entry.source.trusted ? 'text-green-400' : 'text-blue-400'}
              />
            </>
          )}
        </div>

        {/* Description */}
        {(isInstalled ? plugin!.description : item.entry.description) && (
          <div>
            <h3 className="mb-1 text-xs font-medium text-text-secondary">Description</h3>
            <p className="text-xs text-text-tertiary leading-relaxed">
              {isInstalled ? plugin!.description : item.entry.description}
            </p>
          </div>
        )}

        {/* Skills */}
        {isInstalled && skills.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-text-secondary">
              Skills <span className="ml-1 text-[10px] opacity-60">{skills.length}</span>
            </h3>
            <div className="space-y-1">
              {skills.map((skill) => (
                <SkillRow key={skill.id} skill={skill} />
              ))}
            </div>
          </div>
        )}

        {/* Commands */}
        {isInstalled && commands.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-text-secondary">
              Commands <span className="ml-1 text-[10px] opacity-60">{commands.length}</span>
            </h3>
            <div className="space-y-1">
              {commands.map((cmd) => (
                <CommandRow key={cmd.id} command={cmd} />
              ))}
            </div>
          </div>
        )}

        {/* No skills/commands */}
        {isInstalled && detail && skills.length === 0 && commands.length === 0 && (
          <div className="rounded bg-surface-2 px-3 py-2">
            <p className="text-[10px] text-text-tertiary">
              No skills or commands found in this plugin.
            </p>
          </div>
        )}

        {/* Update status */}
        {isInstalled && updateInfo?.hasUpdate && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <p className="text-xs text-amber-400">
              Update available: v{updateInfo.remoteVersion}
            </p>
          </div>
        )}

        {/* Marketplace status badges */}
        {!isInstalled && (
          <div className="flex gap-2">
            {item.entry.installed && (
              <span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                Already installed
              </span>
            )}
            {item.entry.hasUpdate && (
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
                Update available
              </span>
            )}
          </div>
        )}

        {/* License */}
        {isInstalled && plugin?.licenseText && (
          <div>
            <h3 className="mb-1 text-xs font-medium text-text-secondary">License</h3>
            <pre className="max-h-32 overflow-auto rounded bg-surface-2 p-2 text-[10px] text-text-tertiary whitespace-pre-wrap font-mono">
              {plugin.licenseText}
            </pre>
          </div>
        )}

        {/* Notice */}
        {isInstalled && plugin?.noticeText && (
          <div>
            <h3 className="mb-1 text-xs font-medium text-text-secondary">Notice</h3>
            <pre className="max-h-24 overflow-auto rounded bg-surface-2 p-2 text-[10px] text-text-tertiary whitespace-pre-wrap font-mono">
              {plugin.noticeText}
            </pre>
          </div>
        )}

        {/* Install path */}
        {isInstalled && plugin && (
          <div>
            <h3 className="mb-1 text-xs font-medium text-text-secondary">Install Path</h3>
            <p className="text-[10px] text-text-tertiary break-all font-mono">{plugin.installPath}</p>
          </div>
        )}
      </div>

      {/* Actions footer */}
      {isInstalled && plugin && (
        <div className="shrink-0 border-t border-border-subtle px-4 py-3 flex items-center gap-2">
          <button
            onClick={() => onToggle(plugin.id)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              plugin.isEnabled
                ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                : 'bg-surface-2 text-text-tertiary hover:bg-surface-2/80'
            }`}
          >
            {plugin.isEnabled ? 'Enabled' : 'Disabled'}
          </button>

          <div className="flex-1" />

          {confirmUninstall ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleUninstall}
                className="rounded bg-red-500/20 px-2.5 py-1 text-[10px] text-red-400 hover:bg-red-500/30"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmUninstall(false)}
                className="rounded px-2 py-1 text-[10px] text-text-tertiary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmUninstall(true)}
              className="rounded px-2.5 py-1 text-xs text-red-400/70 hover:text-red-400 transition-colors"
            >
              Uninstall
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Skill row ──

function SkillRow({ skill }: { skill: PluginSkillSummary }) {
  return (
    <div className="flex items-start gap-2 rounded bg-surface-2 px-2.5 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-text-primary truncate">{skill.name}</span>
          {skill.hasAssets && (
            <span className="shrink-0 text-[9px] text-text-tertiary opacity-60">+assets</span>
          )}
          {skill.removedUpstreamAt && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[9px] text-amber-400">removed</span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 text-[10px] text-text-tertiary truncate">{skill.description}</p>
        )}
      </div>
      <span className={`shrink-0 text-[9px] mt-0.5 ${skill.isEnabled ? 'text-green-400' : 'text-text-tertiary'}`}>
        {skill.isEnabled ? 'ON' : 'OFF'}
      </span>
    </div>
  )
}

// ── Command row ──

function CommandRow({ command }: { command: PluginCommandSummary }) {
  return (
    <div className="flex items-start gap-2 rounded bg-surface-2 px-2.5 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono font-medium text-accent truncate">
            /{command.canonicalSlug}
          </span>
          {command.argumentHint && (
            <span className="shrink-0 text-[9px] text-text-tertiary opacity-60">{command.argumentHint}</span>
          )}
          {command.removedUpstreamAt && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[9px] text-amber-400">removed</span>
          )}
        </div>
        {command.description && (
          <p className="mt-0.5 text-[10px] text-text-tertiary truncate">{command.description}</p>
        )}
      </div>
      <span className={`shrink-0 text-[9px] mt-0.5 ${command.isEnabled ? 'text-green-400' : 'text-text-tertiary'}`}>
        {command.isEnabled ? 'ON' : 'OFF'}
      </span>
    </div>
  )
}

// ── Detail row ──

function DetailRow({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 w-20 text-[10px] font-medium text-text-tertiary uppercase tracking-wide">
        {label}
      </span>
      <span className={`text-xs break-all ${valueClassName ?? 'text-text-secondary'}`}>
        {value}
      </span>
    </div>
  )
}
