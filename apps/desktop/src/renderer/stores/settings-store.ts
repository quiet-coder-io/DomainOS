import { create } from 'zustand'

interface SettingsState {
  apiKey: string
  loading: boolean
  loadApiKey(): Promise<void>
  setApiKey(key: string): void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: '',
  loading: true,

  async loadApiKey() {
    const result = await window.domainOS.settings.getApiKey()
    if (result.ok && result.value) {
      set({ apiKey: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  setApiKey(key: string) {
    set({ apiKey: key })
    window.domainOS.settings.setApiKey(key)
  },
}))
