import { create } from 'zustand'

const STORAGE_KEY = 'domainOS:apiKey'

interface SettingsState {
  apiKey: string
  setApiKey(key: string): void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: localStorage.getItem(STORAGE_KEY) ?? '',

  setApiKey(key: string) {
    localStorage.setItem(STORAGE_KEY, key)
    set({ apiKey: key })
  },
}))
