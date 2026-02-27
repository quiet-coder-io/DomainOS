import { create } from 'zustand'
import type { ProviderKeysStatus, ProviderConfig, ToolTestResult } from '../../preload/api'

interface SettingsState {
  // Legacy (backward compat — maps to anthropic key)
  apiKey: string
  loading: boolean
  loadApiKey(): Promise<void>
  setApiKey(key: string): void

  // Multi-provider keys (boolean+last4, D7)
  providerKeys: ProviderKeysStatus | null
  loadProviderKeysStatus(): Promise<void>
  setProviderKey(provider: string, key: string): Promise<void>
  clearProviderKey(provider: string): Promise<void>

  // Global defaults
  providerConfig: ProviderConfig | null
  loadProviderConfig(): Promise<void>
  setProviderConfig(config: ProviderConfig): Promise<void>

  // Ollama
  ollamaConnected: boolean
  ollamaModels: string[]
  testOllama(baseUrl?: string): Promise<boolean>
  listOllamaModels(baseUrl?: string): Promise<string[]>

  // Tool capability probe
  testTools(provider: string, model: string): Promise<ToolTestResult | null>

  // GCP OAuth
  gcpOAuthConfigured: boolean | null
  gcpOAuthHasBuiltIn: boolean
  gcpOAuthHasOverride: boolean
  loadGCPOAuthStatus(): Promise<void>
  setGCPOAuth(clientId: string, clientSecret: string): Promise<void>
  clearGCPOAuth(): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  apiKey: '',
  loading: true,
  providerKeys: null,
  providerConfig: null,
  ollamaConnected: false,
  ollamaModels: [],
  gcpOAuthConfigured: null,
  gcpOAuthHasBuiltIn: false,
  gcpOAuthHasOverride: false,

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

  async loadProviderKeysStatus() {
    const result = await window.domainOS.settings.getProviderKeysStatus()
    if (result.ok && result.value) {
      set({ providerKeys: result.value })
    }
  },

  async setProviderKey(provider: string, key: string) {
    await window.domainOS.settings.setProviderKey(provider, key)
    // Refresh status
    await get().loadProviderKeysStatus()
  },

  async clearProviderKey(provider: string) {
    await window.domainOS.settings.clearProviderKey(provider)
    await get().loadProviderKeysStatus()
  },

  async loadProviderConfig() {
    const result = await window.domainOS.settings.getProviderConfig()
    if (result.ok && result.value) {
      set({ providerConfig: result.value })
    }
  },

  async setProviderConfig(config: ProviderConfig) {
    await window.domainOS.settings.setProviderConfig(config)
    set({ providerConfig: config })
  },

  async testOllama(baseUrl?: string) {
    const result = await window.domainOS.settings.testOllama(baseUrl)
    const connected = result.ok && result.value === true
    set({ ollamaConnected: connected })
    return connected
  },

  async listOllamaModels(baseUrl?: string) {
    const result = await window.domainOS.settings.listOllamaModels(baseUrl)
    const models = result.ok && result.value ? result.value : []
    set({ ollamaModels: models })
    return models
  },

  async testTools(provider: string, model: string) {
    const result = await window.domainOS.settings.testTools(provider, model)
    if (result.ok && result.value) {
      return result.value
    }
    return null
  },

  async loadGCPOAuthStatus() {
    const result = await window.domainOS.settings.getGCPOAuthStatus()
    if (result.ok && result.value) {
      set({
        gcpOAuthConfigured: result.value.configured,
        gcpOAuthHasBuiltIn: result.value.hasBuiltIn,
        gcpOAuthHasOverride: result.value.hasOverride,
      })
    }
  },

  async setGCPOAuth(clientId: string, clientSecret: string) {
    await window.domainOS.settings.setGCPOAuth(clientId, clientSecret)
    set({ gcpOAuthConfigured: true, gcpOAuthHasOverride: true })
  },

  async clearGCPOAuth() {
    await window.domainOS.settings.clearGCPOAuth()
    // After clearing override, re-check status (built-in may still be available)
    const result = await window.domainOS.settings.getGCPOAuthStatus()
    if (result.ok && result.value) {
      set({
        gcpOAuthConfigured: result.value.configured,
        gcpOAuthHasBuiltIn: result.value.hasBuiltIn,
        gcpOAuthHasOverride: false,
      })
    } else {
      set({ gcpOAuthConfigured: false, gcpOAuthHasOverride: false })
    }
  },
}))
