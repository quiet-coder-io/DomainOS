import { create } from 'zustand'
import type { Skill, SkillListItem } from '../../preload/api'

const EMPTY_SKILLS: Skill[] = []

interface SkillState {
  skillsByDomain: Record<string, Skill[]>              // per-domain enabled skills for selector
  skillsLoadedAtByDomain: Record<string, number>       // per-domain cache timestamps
  allSkills: Skill[]                                    // all skills for library management
  allSkillItems: SkillListItem[]                        // all skills with plugin metadata for library UI
  loading: boolean
  activeSkillIdByDomain: Record<string, string | null>  // domain-scoped activation

  fetchSkills(domainId: string, force?: boolean): Promise<void>
  fetchAllSkills(): Promise<void>
  fetchAllSkillItems(domainId?: string): Promise<void>
  createSkill(input: Parameters<typeof window.domainOS.skill.create>[0]): Promise<Skill | null>
  updateSkill(id: string, input: Parameters<typeof window.domainOS.skill.update>[1]): Promise<boolean>
  deleteSkill(id: string): Promise<boolean>
  toggleSkill(id: string): Promise<boolean>
  setActiveSkill(domainId: string, skillId: string | null): void
  getActiveSkillId(domainId: string): string | null
  clearActiveSkill(domainId: string): void
  getSkillsForDomain(domainId: string): Skill[]
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export const useSkillStore = create<SkillState>((set, get) => ({
  skillsByDomain: {},
  skillsLoadedAtByDomain: {},
  allSkills: [],
  allSkillItems: [],
  loading: false,
  activeSkillIdByDomain: {},

  async fetchSkills(domainId: string, force = false) {
    const state = get()
    const loadedAt = state.skillsLoadedAtByDomain[domainId]
    // Skip if loaded recently (unless forced)
    if (!force && loadedAt && Date.now() - loadedAt < CACHE_TTL_MS) {
      return
    }

    set({ loading: true })
    const result = await window.domainOS.skill.listEnabledForDomain(domainId)
    if (result.ok && result.value) {
      const enabledSkills = result.value
      const enabledIds = new Set(enabledSkills.map((s) => s.id))

      // Auto-clear stale selection: if activeSkillId not in enabled list, clear it
      const currentActive = get().activeSkillIdByDomain[domainId]
      const newActiveMap = { ...get().activeSkillIdByDomain }
      if (currentActive && !enabledIds.has(currentActive)) {
        newActiveMap[domainId] = null
      }

      set({
        skillsByDomain: { ...get().skillsByDomain, [domainId]: enabledSkills },
        skillsLoadedAtByDomain: { ...get().skillsLoadedAtByDomain, [domainId]: Date.now() },
        loading: false,
        activeSkillIdByDomain: newActiveMap,
      })
    } else {
      console.warn('[skill-store] fetchSkills failed for domain', domainId, result)
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

  async fetchAllSkillItems(domainId?: string) {
    set({ loading: true })
    try {
      const result = await window.domainOS.skill.listWithMeta(domainId)
      if (result.ok && result.value) {
        set({ allSkillItems: result.value, loading: false })
      } else {
        console.warn('[skill-store] fetchAllSkillItems failed:', result.error)
        set({ loading: false })
      }
    } catch (e) {
      console.error('[skill-store] fetchAllSkillItems error:', e)
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
      const state = get()
      // Remove from allSkills
      const allSkills = state.allSkills.filter((s) => s.id !== id)
      // Remove from all per-domain caches
      const skillsByDomain: Record<string, Skill[]> = {}
      for (const [did, skills] of Object.entries(state.skillsByDomain)) {
        skillsByDomain[did] = skills.filter((s) => s.id !== id)
      }
      set({ allSkills, skillsByDomain })
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

  getSkillsForDomain(domainId) {
    return get().skillsByDomain[domainId] ?? EMPTY_SKILLS
  },
}))

// Store-level listener: invalidate all per-domain caches when skills change.
// This runs once at module load, survives component unmount/remount cycles.
// When SkillSelector mounts and calls fetchSkills(domainId, false), it will
// see the expired cache and refetch from the main process.
window.domainOS.skill.onChanged(() => {
  useSkillStore.setState({ skillsLoadedAtByDomain: {}, skillsByDomain: {} })
})
