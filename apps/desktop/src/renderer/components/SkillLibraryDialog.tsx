import { useState, useEffect } from 'react'
import { useSkillStore } from '../stores/skill-store'
import { SkillEditor } from './SkillEditor'
import type { SkillListItem, SkillOutputFormat } from '../../preload/api'
import { primaryButtonClass } from './ui'

interface Props {
  domainId: string
  onClose(): void
}

type View = 'list' | 'create' | 'edit'
type Filter = 'all' | 'enabled' | 'disabled'

/** Compute whether a plugin skill is effectively available in the current domain. */
function isEffectivelyEnabled(s: SkillListItem): boolean {
  if (!s.pluginId) return s.isEnabled
  // Plugin skill: all three layers must be on
  // pluginIsEnabledForDomain null = no assoc row = default enabled
  const globalOn = s.pluginIsEnabledGlobal === true
  const domainOn = s.pluginIsEnabledForDomain !== false
  return s.isEnabled && globalOn && domainOn
}

type PluginState = 'active' | 'plugin-off' | 'plugin-missing' | 'removed-upstream' | 'domain-disabled'

function getPluginState(s: SkillListItem): PluginState {
  if (!s.pluginId) return 'active'
  if (s.removedUpstreamAt) return 'removed-upstream'
  if (s.pluginIsEnabledGlobal == null) return 'plugin-missing'
  if (!s.pluginIsEnabledGlobal) return 'plugin-off'
  if (s.pluginIsEnabledForDomain === false) return 'domain-disabled'
  return 'active'
}

export function SkillLibraryDialog({ domainId, onClose }: Props) {
  const allSkillItems = useSkillStore((s) => s.allSkillItems)
  const loading = useSkillStore((s) => s.loading)
  const { fetchAllSkillItems, createSkill, updateSkill, deleteSkill, toggleSkill } = useSkillStore.getState()

  const [view, setView] = useState<View>('list')
  const [editingSkill, setEditingSkill] = useState<SkillListItem | null>(null)
  const [viewReadOnly, setViewReadOnly] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [hasEdits, setHasEdits] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    fetchAllSkillItems(domainId)
  }, [domainId])

  const filteredSkills = allSkillItems.filter((s) => {
    if (filter === 'enabled' && !isEffectivelyEnabled(s)) return false
    if (filter === 'disabled' && isEffectivelyEnabled(s)) return false
    if (search) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    }
    return true
  })

  const customSkills = filteredSkills.filter((s) => !s.pluginId)
  const pluginSkills = filteredSkills.filter((s) => s.pluginId)

  async function handleCreate(input: {
    name: string; description: string; content: string; outputFormat: SkillOutputFormat
    outputSchema: string | null; toolHints: string[]
  }) {
    const result = await createSkill(input)
    if (result) {
      setHasEdits(true)
      setView('list')
      fetchAllSkillItems(domainId)
    }
  }

  async function handleUpdate(input: {
    name: string; description: string; content: string; outputFormat: SkillOutputFormat
    outputSchema: string | null; toolHints: string[]
  }) {
    if (!editingSkill) return
    const ok = await updateSkill(editingSkill.id, input)
    if (ok) {
      setHasEdits(true)
      setView('list')
      setEditingSkill(null)
      fetchAllSkillItems(domainId)
    }
  }

  async function handleDelete(id: string) {
    const ok = await deleteSkill(id)
    if (ok) {
      setHasEdits(true)
      setConfirmDeleteId(null)
      fetchAllSkillItems(domainId)
    }
  }

  async function handleToggle(id: string) {
    const ok = await toggleSkill(id)
    if (ok) {
      setHasEdits(true)
      fetchAllSkillItems(domainId)
    }
  }

  async function handleExport(id: string) {
    await window.domainOS.skill.export(id)
  }

  async function handleImport() {
    const result = await window.domainOS.skill.import()
    if (result.ok) {
      setHasEdits(true)
      fetchAllSkillItems(domainId)
    }
  }

  function handleClose() {
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface-0 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 className="text-base font-semibold text-text-primary">
            {view === 'list' ? 'Skill Library' : view === 'create' ? 'New Skill' : viewReadOnly ? 'View Skill' : 'Edit Skill'}
          </h2>
          <div className="flex items-center gap-2">
            {view === 'list' && (
              <>
                <button onClick={handleImport} className="rounded border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-2">
                  Import
                </button>
                <button onClick={() => setView('create')} className={primaryButtonClass + ' !py-1 !px-2.5 !text-xs'}>
                  + New Skill
                </button>
              </>
            )}
            <button onClick={handleClose} className="text-text-tertiary hover:text-text-secondary text-lg leading-none">&times;</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {view === 'list' && (
            <>
              {/* Filters */}
              <div className="mb-3 flex items-center gap-3">
                <div className="flex gap-1">
                  {(['all', 'enabled', 'disabled'] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded px-2 py-0.5 text-xs capitalize ${
                        filter === f
                          ? 'bg-accent/10 text-accent font-medium'
                          : 'text-text-tertiary hover:text-text-secondary'
                      }`}
                    >
                      {f === 'enabled' ? 'Available' : f === 'disabled' ? 'Unavailable' : f}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 rounded border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none"
                  placeholder="Search skills..."
                />
              </div>

              {/* Skills list */}
              {loading && allSkillItems.length === 0 ? (
                <p className="text-xs text-text-tertiary">Loading...</p>
              ) : filteredSkills.length === 0 ? (
                <p className="text-xs text-text-tertiary">
                  {allSkillItems.length === 0 ? 'No skills yet. Create one to get started.' : 'No skills match your filter.'}
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Custom Skills */}
                  {customSkills.length > 0 && (
                    <SkillSection title={`Your Skills (${customSkills.length})`}>
                      {customSkills.map((skill) => (
                        <SkillCard
                          key={skill.id}
                          skill={skill}
                          onToggle={handleToggle}
                          onEdit={(s) => { setEditingSkill(s); setViewReadOnly(false); setView('edit') }}
                          onExport={handleExport}
                          onDelete={(id) => setConfirmDeleteId(id)}
                          confirmDeleteId={confirmDeleteId}
                          onConfirmDelete={handleDelete}
                          onCancelDelete={() => setConfirmDeleteId(null)}
                        />
                      ))}
                    </SkillSection>
                  )}

                  {/* Plugin Skills */}
                  {pluginSkills.length > 0 && (
                    <SkillSection
                      title={`Plugin Skills (${pluginSkills.length})`}
                      subtitle="Managed via Plugins page. Toggle individual skills below."
                    >
                      {pluginSkills.map((skill) => (
                        <PluginSkillCard
                          key={skill.id}
                          skill={skill}
                          onToggle={handleToggle}
                          onEdit={(s, ro) => { setEditingSkill(s); setViewReadOnly(ro); setView('edit') }}
                          onExport={handleExport}
                        />
                      ))}
                    </SkillSection>
                  )}
                </div>
              )}
            </>
          )}

          {view === 'create' && (
            <SkillEditor
              onSave={handleCreate}
              onCancel={() => setView('list')}
            />
          )}

          {view === 'edit' && editingSkill && (
            <SkillEditor
              skill={editingSkill}
              readOnly={viewReadOnly}
              onSave={handleUpdate}
              onCancel={() => { setView('list'); setEditingSkill(null); setViewReadOnly(false) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Section wrapper ──

function SkillSection({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{title}</h3>
        {subtitle && <p className="text-[0.65rem] text-text-tertiary mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

// ── Custom Skill Card (unchanged behavior) ──

function SkillCard({ skill, onToggle, onEdit, onExport, onDelete, confirmDeleteId, onConfirmDelete, onCancelDelete }: {
  skill: SkillListItem
  onToggle(id: string): void
  onEdit(skill: SkillListItem): void
  onExport(id: string): void
  onDelete(id: string): void
  confirmDeleteId: string | null
  onConfirmDelete(id: string): void
  onCancelDelete(): void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${skill.isEnabled ? 'text-text-primary' : 'text-text-tertiary'}`}>
            {skill.name}
          </span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.6rem] text-text-tertiary">
            {skill.outputFormat}
          </span>
          {skill.toolHints.length > 0 && (
            <span className="text-[0.6rem] text-text-tertiary">
              {skill.toolHints.length} tool{skill.toolHints.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 text-xs text-text-tertiary truncate">{skill.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={() => onToggle(skill.id)}
          className={`rounded px-2 py-0.5 text-[0.6rem] ${
            skill.isEnabled
              ? 'bg-success/10 text-success'
              : 'bg-surface-2 text-text-tertiary'
          }`}
          title={skill.isEnabled ? 'Disable' : 'Enable'}
        >
          {skill.isEnabled ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={() => onEdit(skill)}
          className="rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:text-text-secondary"
          title="Edit"
        >
          Edit
        </button>
        <button
          onClick={() => onExport(skill.id)}
          className="rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:text-text-secondary"
          title="Export"
        >
          Export
        </button>
        {confirmDeleteId === skill.id ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onConfirmDelete(skill.id)}
              className="rounded bg-danger px-1.5 py-0.5 text-[0.6rem] text-white"
            >
              Confirm
            </button>
            <button
              onClick={onCancelDelete}
              className="rounded px-1.5 py-0.5 text-[0.6rem] text-text-tertiary"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => onDelete(skill.id)}
            className="rounded px-1.5 py-0.5 text-xs text-danger/70 hover:text-danger"
            title="Delete"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ── Plugin Skill Card (conditional actions based on plugin state) ──

const PLUGIN_STATE_BADGE: Record<Exclude<PluginState, 'active'>, { label: string; className: string; tooltip: string }> = {
  'plugin-off': {
    label: 'Plugin off',
    className: 'bg-surface-2 text-text-tertiary',
    tooltip: 'Enable the plugin to use this skill',
  },
  'plugin-missing': {
    label: 'Plugin missing',
    className: 'bg-danger/10 text-danger',
    tooltip: 'Plugin has been uninstalled',
  },
  'removed-upstream': {
    label: 'Removed upstream',
    className: 'bg-warning/10 text-warning',
    tooltip: 'This skill was removed in a plugin update',
  },
  'domain-disabled': {
    label: 'Disabled here',
    className: 'bg-surface-2 text-text-tertiary',
    tooltip: 'Plugin is disabled for this domain',
  },
}

function PluginSkillCard({ skill, onToggle, onEdit, onExport }: {
  skill: SkillListItem
  onToggle(id: string): void
  onEdit(skill: SkillListItem, readOnly: boolean): void
  onExport(id: string): void
}) {
  const pluginState = getPluginState(skill)
  const isInactive = pluginState !== 'active'

  return (
    <div className={`flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2 ${
      isInactive ? 'opacity-50' : ''
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${!isInactive && skill.isEnabled ? 'text-text-primary' : 'text-text-tertiary'}`}>
            {skill.name}
          </span>
          {skill.pluginName && (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[0.6rem] text-accent">
              {skill.pluginName}
            </span>
          )}
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.6rem] text-text-tertiary">
            {skill.outputFormat}
          </span>
          {skill.toolHints.length > 0 && (
            <span className="text-[0.6rem] text-text-tertiary">
              {skill.toolHints.length} tool{skill.toolHints.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 text-xs text-text-tertiary truncate">{skill.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {isInactive ? (
          /* State badge replaces toggle when plugin is inactive */
          <span
            className={`rounded px-2 py-0.5 text-[0.6rem] ${PLUGIN_STATE_BADGE[pluginState].className}`}
            title={PLUGIN_STATE_BADGE[pluginState].tooltip}
          >
            {PLUGIN_STATE_BADGE[pluginState].label}
          </span>
        ) : (
          /* Normal toggle when plugin is active */
          <button
            onClick={() => onToggle(skill.id)}
            className={`rounded px-2 py-0.5 text-[0.6rem] ${
              skill.isEnabled
                ? 'bg-success/10 text-success'
                : 'bg-surface-2 text-text-tertiary'
            }`}
            title={`Skill toggle controls availability within this plugin. ${skill.isEnabled ? 'Click to disable' : 'Click to enable'}`}
          >
            {skill.isEnabled ? 'ON' : 'OFF'}
          </button>
        )}

        {/* View (Edit) and Export remain accessible even when plugin inactive */}
        <button
          onClick={() => onEdit(skill, isInactive)}
          className="rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:text-text-secondary"
          title={isInactive ? 'View skill' : 'Edit'}
        >
          {isInactive ? 'View' : 'Edit'}
        </button>
        <button
          onClick={() => onExport(skill.id)}
          className="rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:text-text-secondary"
          title="Export"
        >
          Export
        </button>
        {/* No Delete for plugin skills — lifecycle managed by plugin */}
      </div>
    </div>
  )
}
