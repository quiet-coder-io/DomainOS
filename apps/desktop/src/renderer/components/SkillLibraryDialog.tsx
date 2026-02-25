import { useState, useEffect } from 'react'
import { useSkillStore } from '../stores/skill-store'
import { SkillEditor } from './SkillEditor'
import type { Skill, SkillOutputFormat } from '../../preload/api'
import { primaryButtonClass } from './ui'

interface Props {
  onClose(): void
}

type View = 'list' | 'create' | 'edit'
type Filter = 'all' | 'enabled' | 'disabled'

export function SkillLibraryDialog({ onClose }: Props) {
  const allSkills = useSkillStore((s) => s.allSkills)
  const loading = useSkillStore((s) => s.loading)
  const { fetchAllSkills, createSkill, updateSkill, deleteSkill, toggleSkill, fetchSkills } = useSkillStore.getState()

  const [view, setView] = useState<View>('list')
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [hasEdits, setHasEdits] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    fetchAllSkills()
  }, [])

  const filteredSkills = allSkills.filter((s) => {
    if (filter === 'enabled' && !s.isEnabled) return false
    if (filter === 'disabled' && s.isEnabled) return false
    if (search) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    }
    return true
  })

  async function handleCreate(input: {
    name: string; description: string; content: string; outputFormat: SkillOutputFormat
    outputSchema: string | null; toolHints: string[]
  }) {
    const result = await createSkill(input)
    if (result) {
      setHasEdits(true)
      setView('list')
      fetchAllSkills()
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
      fetchAllSkills()
    }
  }

  async function handleDelete(id: string) {
    const ok = await deleteSkill(id)
    if (ok) {
      setHasEdits(true)
      setConfirmDeleteId(null)
    }
  }

  async function handleToggle(id: string) {
    const ok = await toggleSkill(id)
    if (ok) {
      setHasEdits(true)
      fetchAllSkills()
    }
  }

  async function handleExport(id: string) {
    await window.domainOS.skill.export(id)
  }

  async function handleImport() {
    const result = await window.domainOS.skill.import()
    if (result.ok) {
      setHasEdits(true)
      fetchAllSkills()
    }
  }

  function handleClose() {
    if (hasEdits) fetchSkills(true)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface-0 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 className="text-base font-semibold text-text-primary">
            {view === 'list' ? 'Skill Library' : view === 'create' ? 'New Skill' : 'Edit Skill'}
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
                      {f}
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
              {loading && allSkills.length === 0 ? (
                <p className="text-xs text-text-tertiary">Loading...</p>
              ) : filteredSkills.length === 0 ? (
                <p className="text-xs text-text-tertiary">
                  {allSkills.length === 0 ? 'No skills yet. Create one to get started.' : 'No skills match your filter.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2"
                    >
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
                          onClick={() => handleToggle(skill.id)}
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
                          onClick={() => { setEditingSkill(skill); setView('edit') }}
                          className="rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:text-text-secondary"
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleExport(skill.id)}
                          className="rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:text-text-secondary"
                          title="Export"
                        >
                          Export
                        </button>
                        {confirmDeleteId === skill.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(skill.id)}
                              className="rounded bg-danger px-1.5 py-0.5 text-[0.6rem] text-white"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded px-1.5 py-0.5 text-[0.6rem] text-text-tertiary"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(skill.id)}
                            className="rounded px-1.5 py-0.5 text-xs text-danger/70 hover:text-danger"
                            title="Delete"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
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
              onSave={handleUpdate}
              onCancel={() => { setView('list'); setEditingSkill(null) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
