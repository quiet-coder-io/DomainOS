import { create } from 'zustand'
import type { IntakeItem, ClassifyResult } from '../../preload/api'

interface IntakeState {
  items: IntakeItem[]
  loading: boolean

  fetchPending(): Promise<void>
  classifyItem(id: string): Promise<ClassifyResult | null>
  confirmItem(id: string, domainId: string): Promise<boolean>
  dismissItem(id: string): Promise<boolean>
  getToken(): Promise<string | null>
  getPort(): Promise<number | null>
}

export const useIntakeStore = create<IntakeState>((set, get) => ({
  items: [],
  loading: false,

  async fetchPending() {
    set({ loading: true })
    try {
      const result = await window.domainOS.intake.listPending()
      if (result.ok) {
        set({ items: result.value ?? [], loading: false })
      } else {
        console.error('fetchPending failed:', result.error)
        set({ loading: false })
      }
    } catch (err) {
      console.error('fetchPending error:', err)
      set({ loading: false })
    }
  },

  async classifyItem(id) {
    try {
      const result = await window.domainOS.intake.classify(id, '')
      if (result.ok && result.value) {
        await get().fetchPending()
        return result.value.classification
      }
      console.error('[intake] classify failed:', result)
      return null
    } catch (err) {
      console.error('[intake] classify error:', err)
      return null
    }
  },

  async confirmItem(id, domainId) {
    try {
      const result = await window.domainOS.intake.confirm(id, domainId)
      if (result.ok) {
        await get().fetchPending()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  async dismissItem(id) {
    try {
      const result = await window.domainOS.intake.dismiss(id)
      if (result.ok) {
        await get().fetchPending()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  async getToken() {
    try {
      const result = await window.domainOS.intake.getToken()
      return result.ok ? (result.value ?? null) : null
    } catch {
      return null
    }
  },

  async getPort() {
    try {
      const result = await window.domainOS.intake.getPort()
      return result.ok ? (result.value ?? null) : null
    } catch {
      return null
    }
  },
}))
