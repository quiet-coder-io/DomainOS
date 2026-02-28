import { useEffect } from 'react'
import { useSkillStore } from '../stores'
import type { Skill } from '../../preload/api'

const EMPTY_SKILLS: Skill[] = []

interface Props {
  domainId: string
}

export function SkillSelector({ domainId }: Props) {
  const skills = useSkillStore((s) => s.skillsByDomain[domainId] ?? EMPTY_SKILLS)
  const fetchSkills = useSkillStore((s) => s.fetchSkills)
  const activeSkillId = useSkillStore((s) => s.activeSkillIdByDomain[domainId] ?? null)
  const setActiveSkill = useSkillStore((s) => s.setActiveSkill)

  useEffect(() => {
    fetchSkills(domainId, false)
  }, [domainId, fetchSkills])

  // Listen for skills:changed events (plugin toggle, install, uninstall, etc.)
  useEffect(() => {
    const off = window.domainOS.skill.onChanged(() => fetchSkills(domainId, true))
    return off
  }, [domainId, fetchSkills])

  if (skills.length === 0) return null

  return (
    <div className="mb-1">
      <div className="flex flex-wrap gap-1.5">
        {skills.map((skill) => {
          const isActive = activeSkillId === skill.id
          return (
            <button
              key={skill.id}
              onClick={() => setActiveSkill(domainId, isActive ? null : skill.id)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                isActive
                  ? 'border border-accent bg-accent/10 text-accent font-medium'
                  : 'border border-border bg-surface-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary'
              }`}
              title={skill.description || skill.name}
            >
              <span>{skill.name}</span>
              {isActive && (
                <span className="ml-0.5 text-accent/70 hover:text-accent">&times;</span>
              )}
            </button>
          )
        })}
      </div>
      {activeSkillId && (
        <div className="mt-0.5 text-[0.6rem] text-text-tertiary">
          Applies to next message only.
        </div>
      )}
    </div>
  )
}
