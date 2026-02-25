import { create } from 'zustand'
import type { Skill } from '../../preload/api'

interface SkillState {
  skills: Skill[]                                         // enabled skills for selector
  allSkills: Skill[]                                      // all skills for library management
  loading: boolean
  skillsLoadedAt: number | null                           // timestamp for cache staleness
  activeSkillIdByDomain: Record<string, string | null>    // domain-scoped activation

  fetchSkills(force?: boolean): Promise<void>
  fetchAllSkills(): Promise<void>
  createSkill(input: Parameters<typeof window.domainOS.skill.create>[0]): Promise<Skill | null>
  updateSkill(id: string, input: Parameters<typeof window.domainOS.skill.update>[1]): Promise<boolean>
  deleteSkill(id: string): Promise<boolean>
  toggleSkill(id: string): Promise<boolean>
  setActiveSkill(domainId: string, skillId: string | null): void
  getActiveSkillId(domainId: string): string | null
  clearActiveSkill(domainId: string): void
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  allSkills: [],
  loading: false,
  skillsLoadedAt: null,
  activeSkillIdByDomain: {},

  async fetchSkills(force = false) {
    const state = get()
    // Skip if loaded recently (unless forced)
    if (!force && state.skillsLoadedAt && Date.now() - state.skillsLoadedAt < CACHE_TTL_MS) {
      return
    }

    set({ loading: true })
    const result = await window.domainOS.skill.listEnabled()
    if (result.ok && result.value) {
      const enabledSkills = result.value
      const enabledIds = new Set(enabledSkills.map((s) => s.id))

      // Auto-clear stale selections: if activeSkillId not in enabled list, clear it
      const newActiveMap = { ...state.activeSkillIdByDomain }
      for (const [domainId, skillId] of Object.entries(newActiveMap)) {
        if (skillId && !enabledIds.has(skillId)) {
          newActiveMap[domainId] = null
        }
      }

      set({
        skills: enabledSkills,
        loading: false,
        skillsLoadedAt: Date.now(),
        activeSkillIdByDomain: newActiveMap,
      })
    } else {
      set({ loading: false })
    }
  },

  async fetchAllSkills() {
    set({ loading: true })
    const result = await window.domainOS.skill.list()
    if (result.ok && result.value) {
      set({ allSkills: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async createSkill(input) {
    const result = await window.domainOS.skill.create(input)
    if (result.ok && result.value) {
      set({ allSkills: [...get().allSkills, result.value] })
      return result.value
    }
    return null
  },

  async updateSkill(id, input) {
    const result = await window.domainOS.skill.update(id, input)
    if (result.ok && result.value) {
      set({
        allSkills: get().allSkills.map((s) => (s.id === id ? result.value! : s)),
      })
      return true
    }
    return false
  },

  async deleteSkill(id) {
    const result = await window.domainOS.skill.delete(id)
    if (result.ok) {
      set({
        allSkills: get().allSkills.filter((s) => s.id !== id),
        skills: get().skills.filter((s) => s.id !== id),
      })
      return true
    }
    return false
  },

  async toggleSkill(id) {
    const result = await window.domainOS.skill.toggle(id)
    if (result.ok && result.value) {
      set({
        allSkills: get().allSkills.map((s) => (s.id === id ? result.value! : s)),
      })
      return true
    }
    return false
  },

  setActiveSkill(domainId, skillId) {
    set((s) => ({
      activeSkillIdByDomain: { ...s.activeSkillIdByDomain, [domainId]: skillId },
    }))
  },

  getActiveSkillId(domainId) {
    return get().activeSkillIdByDomain[domainId] ?? null
  },

  clearActiveSkill(domainId) {
    set((s) => ({
      activeSkillIdByDomain: { ...s.activeSkillIdByDomain, [domainId]: null },
    }))
  },
}))
