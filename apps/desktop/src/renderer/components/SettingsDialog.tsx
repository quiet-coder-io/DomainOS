import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../stores'
import type { ProviderConfig, ToolTestResult, EmbeddingStatus } from '../../preload/api'
import { inputClass, primaryButtonClass, secondaryButtonClass } from './ui'

type EmbeddingProviderOption = 'auto' | 'ollama' | 'openai' | 'off'

interface Props {
  onClose(): void
}

type ProviderName = 'anthropic' | 'openai' | 'ollama'

const KNOWN_MODELS: Record<ProviderName, string[]> = {
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-6',
  ],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
  ollama: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'mixtral'],
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3.2',
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama (Local)',
}

type Tab = 'keys' | 'defaults'

export function SettingsDialog({ onClose }: Props): React.JSX.Element {
  const {
    providerKeys,
    providerConfig,
    ollamaConnected,
    ollamaModels,
    gcpOAuthConfigured,
    gcpOAuthHasBuiltIn,
    gcpOAuthHasOverride,
    loadProviderKeysStatus,
    loadProviderConfig,
    loadGCPOAuthStatus,
    setProviderKey,
    clearProviderKey,
    setProviderConfig,
    setGCPOAuth,
    clearGCPOAuth,
    testOllama,
    listOllamaModels,
    testTools,
    reindexEmbeddings,
  } = useSettingsStore()

  const [tab, setTab] = useState<Tab>('keys')

  // Key input state
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // GCP OAuth state
  const [gcpClientId, setGcpClientId] = useState('')
  const [gcpClientSecret, setGcpClientSecret] = useState('')
  const [gcpSaving, setGcpSaving] = useState(false)
  const [gcpShowCustomForm, setGcpShowCustomForm] = useState(false)

  // Ollama state
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [ollamaTesting, setOllamaTesting] = useState(false)

  // Global defaults state
  const [defaultProvider, setDefaultProvider] = useState<ProviderName>('anthropic')
  const [defaultModel, setDefaultModel] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [useCustomModel, setUseCustomModel] = useState(false)

  // Tool test state
  const [toolTestResult, setToolTestResult] = useState<ToolTestResult | null>(null)
  const [toolTesting, setToolTesting] = useState(false)

  // Response style
  const [responseStyle, setResponseStyle] = useState<'concise' | 'detailed'>('concise')

  // KB search / embedding state
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProviderOption>('auto')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [reindexing, setReindexing] = useState(false)

  // Load state on mount
  useEffect(() => {
    loadProviderKeysStatus()
    loadProviderConfig()
    loadGCPOAuthStatus()
  }, [loadProviderKeysStatus, loadProviderConfig, loadGCPOAuthStatus])

  // Sync local state from loaded providerConfig
  useEffect(() => {
    if (!providerConfig) return
    const p = providerConfig.defaultProvider as ProviderName
    setDefaultProvider(p)
    setOllamaUrl(providerConfig.ollamaBaseUrl || 'http://localhost:11434')

    const knownForProvider = KNOWN_MODELS[p] ?? []
    if (knownForProvider.includes(providerConfig.defaultModel)) {
      setDefaultModel(providerConfig.defaultModel)
      setUseCustomModel(false)
      setCustomModel('')
    } else {
      setDefaultModel('__custom__')
      setUseCustomModel(true)
      setCustomModel(providerConfig.defaultModel)
    }

    // Response style + Embedding config
    setResponseStyle(providerConfig.responseStyle ?? 'concise')
    setEmbeddingProvider(providerConfig.embeddingProvider ?? 'auto')
    setEmbeddingModel(providerConfig.embeddingModel ?? '')
  }, [providerConfig])

  // --- Key handlers ---

  const handleSaveKey = useCallback(async (provider: ProviderName, key: string) => {
    if (!key.trim()) return
    setSavingKey(provider)
    await setProviderKey(provider, key.trim())
    if (provider === 'anthropic') setAnthropicKey('')
    if (provider === 'openai') setOpenaiKey('')
    setSavingKey(null)
  }, [setProviderKey])

  const handleClearKey = useCallback(async (provider: ProviderName) => {
    setSavingKey(provider)
    await clearProviderKey(provider)
    setSavingKey(null)
  }, [clearProviderKey])

  // --- Ollama handlers ---

  const handleTestOllama = useCallback(async () => {
    setOllamaTesting(true)
    const url = ollamaUrl.trim() || undefined
    const connected = await testOllama(url)
    if (connected) {
      await listOllamaModels(url)
    }
    setOllamaTesting(false)
  }, [ollamaUrl, testOllama, listOllamaModels])

  // --- GCP OAuth handlers ---

  const handleSaveGCPOAuth = useCallback(async () => {
    if (!gcpClientId.trim() || !gcpClientSecret.trim()) return
    setGcpSaving(true)
    await setGCPOAuth(gcpClientId.trim(), gcpClientSecret.trim())
    setGcpClientId('')
    setGcpClientSecret('')
    setGcpSaving(false)
  }, [gcpClientId, gcpClientSecret, setGCPOAuth])

  const handleClearGCPOAuth = useCallback(async () => {
    setGcpSaving(true)
    await clearGCPOAuth()
    setGcpSaving(false)
  }, [clearGCPOAuth])

  // --- Defaults handlers ---

  const handleSaveDefaults = useCallback(async () => {
    const model = useCustomModel ? customModel.trim() : defaultModel
    if (!model) return

    const config: ProviderConfig = {
      version: 1,
      defaultProvider,
      defaultModel: model,
      ollamaBaseUrl: ollamaUrl.trim() || 'http://localhost:11434',
      responseStyle,
      embeddingProvider,
      embeddingModel: embeddingModel.trim() || undefined,
    }
    await setProviderConfig(config)
    onClose()
  }, [defaultProvider, defaultModel, customModel, useCustomModel, ollamaUrl, responseStyle, embeddingProvider, embeddingModel, setProviderConfig, onClose])

  const handleProviderChange = useCallback((p: ProviderName) => {
    setDefaultProvider(p)
    const def = DEFAULT_MODELS[p]
    setDefaultModel(def)
    setUseCustomModel(false)
    setCustomModel('')
    setToolTestResult(null)
  }, [])

  const handleModelChange = useCallback((val: string) => {
    if (val === '__custom__') {
      setDefaultModel('__custom__')
      setUseCustomModel(true)
    } else {
      setDefaultModel(val)
      setUseCustomModel(false)
      setCustomModel('')
    }
    setToolTestResult(null)
  }, [])

  // --- Re-index embeddings ---

  const handleReindex = useCallback(async () => {
    setReindexing(true)
    await reindexEmbeddings()
    setReindexing(false)
  }, [reindexEmbeddings])

  // --- Tool test ---

  const handleTestTools = useCallback(async () => {
    const model = useCustomModel ? customModel.trim() : defaultModel
    if (!model || model === '__custom__') return
    setToolTesting(true)
    setToolTestResult(null)
    const result = await testTools(defaultProvider, model)
    setToolTestResult(result)
    setToolTesting(false)
  }, [defaultProvider, defaultModel, customModel, useCustomModel, testTools])

  // --- Key section renderer ---

  function renderKeySection(provider: ProviderName, keyValue: string, setKeyValue: (v: string) => void): React.JSX.Element {
    const status = providerKeys?.[provider]
    const isSaving = savingKey === provider

    return (
      <div className="mb-4 rounded border border-border-subtle bg-surface-0 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-text-primary">{PROVIDER_LABELS[provider]}</span>
          {status?.hasKey && (
            <span className="text-xs text-success">
              Connected: ****{status.last4}
            </span>
          )}
        </div>

        {status?.hasKey ? (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              className={`flex-1 ${inputClass}`}
              placeholder="Enter new key to replace..."
            />
            <button
              onClick={() => handleSaveKey(provider, keyValue)}
              disabled={isSaving || !keyValue.trim()}
              className="rounded bg-accent px-3 py-2 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {isSaving ? '...' : 'Replace'}
            </button>
            <button
              onClick={() => handleClearKey(provider)}
              disabled={isSaving}
              className="rounded border border-border px-3 py-2 text-xs text-text-tertiary hover:text-danger hover:border-danger disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              className={`flex-1 ${inputClass}`}
              placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            />
            <button
              onClick={() => handleSaveKey(provider, keyValue)}
              disabled={isSaving || !keyValue.trim()}
              className="rounded bg-accent px-3 py-2 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface-1 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <h3 className="text-lg font-semibold text-text-primary">Settings</h3>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-subtle px-6">
          <button
            onClick={() => setTab('keys')}
            className={`px-3 py-2.5 text-sm border-b-2 transition-colors ${
              tab === 'keys'
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            API Keys
          </button>
          <button
            onClick={() => setTab('defaults')}
            className={`px-3 py-2.5 text-sm border-b-2 transition-colors ${
              tab === 'defaults'
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            Model Defaults
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {tab === 'keys' && (
            <>
              {renderKeySection('anthropic', anthropicKey, setAnthropicKey)}
              {renderKeySection('openai', openaiKey, setOpenaiKey)}

              {/* Ollama — no key, just connection */}
              <div className="mb-4 rounded border border-border-subtle bg-surface-0 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text-primary">Ollama (Local)</span>
                  <span className="text-xs text-text-tertiary">No key required</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className={`flex-1 ${inputClass}`}
                    placeholder="http://localhost:11434"
                  />
                  <button
                    onClick={handleTestOllama}
                    disabled={ollamaTesting}
                    className="rounded border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50"
                  >
                    {ollamaTesting ? 'Testing...' : 'Test'}
                  </button>
                </div>
                {ollamaConnected && (
                  <div className="mt-2">
                    <span className="text-xs text-success">Connected</span>
                    {ollamaModels.length > 0 && (
                      <span className="ml-2 text-xs text-text-tertiary">
                        {ollamaModels.length} model{ollamaModels.length === 1 ? '' : 's'} available
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Google OAuth */}
              <div className="mb-4 rounded border border-border-subtle bg-surface-0 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text-primary">Google OAuth</span>
                  {gcpOAuthHasOverride ? (
                    <span className="text-xs text-success">Custom</span>
                  ) : gcpOAuthHasBuiltIn ? (
                    <span className="text-xs text-success">Using built-in defaults</span>
                  ) : null}
                </div>
                <p className="text-xs text-text-tertiary mb-2">
                  Required for Gmail and Google Tasks.
                  {!gcpOAuthHasBuiltIn && !gcpOAuthHasOverride && (
                    <> Create a Desktop OAuth client in your{' '}
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      GCP Console
                    </a>{' '}
                    with Gmail and Tasks API scopes enabled.</>
                  )}
                </p>

                {gcpOAuthHasOverride ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleClearGCPOAuth}
                      disabled={gcpSaving}
                      className="rounded border border-border px-3 py-2 text-xs text-text-tertiary hover:text-danger hover:border-danger disabled:opacity-50"
                    >
                      {gcpSaving ? '...' : 'Remove custom credentials'}
                    </button>
                  </div>
                ) : gcpOAuthHasBuiltIn ? (
                  <div>
                    <button
                      onClick={() => setGcpShowCustomForm(!gcpShowCustomForm)}
                      className="text-xs text-text-tertiary hover:text-text-secondary"
                    >
                      {gcpShowCustomForm ? 'Cancel' : 'Use custom credentials'}
                    </button>
                    {gcpShowCustomForm && (
                      <div className="mt-2 space-y-2">
                        <input
                          type="text"
                          value={gcpClientId}
                          onChange={(e) => setGcpClientId(e.target.value)}
                          className={inputClass}
                          placeholder="Client ID"
                        />
                        <input
                          type="password"
                          value={gcpClientSecret}
                          onChange={(e) => setGcpClientSecret(e.target.value)}
                          className={inputClass}
                          placeholder="Client Secret"
                        />
                        <button
                          onClick={handleSaveGCPOAuth}
                          disabled={gcpSaving || !gcpClientId.trim() || !gcpClientSecret.trim()}
                          className="rounded bg-accent px-3 py-2 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
                        >
                          {gcpSaving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={gcpClientId}
                      onChange={(e) => setGcpClientId(e.target.value)}
                      className={inputClass}
                      placeholder="Client ID"
                    />
                    <input
                      type="password"
                      value={gcpClientSecret}
                      onChange={(e) => setGcpClientSecret(e.target.value)}
                      className={inputClass}
                      placeholder="Client Secret"
                    />
                    <button
                      onClick={handleSaveGCPOAuth}
                      disabled={gcpSaving || !gcpClientId.trim() || !gcpClientSecret.trim()}
                      className="rounded bg-accent px-3 py-2 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {gcpSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>

              <p className="text-xs text-text-tertiary">
                Keys are encrypted via Electron safeStorage and never leave your machine.
              </p>
            </>
          )}

          {tab === 'defaults' && (
            <>
              {/* Provider */}
              <label className="mb-3 block">
                <span className="mb-1 block text-sm text-text-secondary">Default Provider</span>
                <select
                  value={defaultProvider}
                  onChange={(e) => handleProviderChange(e.target.value as ProviderName)}
                  className={inputClass}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </label>

              {/* Model */}
              <label className="mb-3 block">
                <span className="mb-1 block text-sm text-text-secondary">Default Model</span>
                <select
                  value={useCustomModel ? '__custom__' : defaultModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className={inputClass}
                >
                  {(defaultProvider === 'ollama' && ollamaModels.length > 0
                    ? [...new Set([...ollamaModels, ...KNOWN_MODELS.ollama])]
                    : KNOWN_MODELS[defaultProvider]
                  ).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom...</option>
                </select>
              </label>

              {useCustomModel && (
                <label className="mb-3 block">
                  <span className="mb-1 block text-sm text-text-secondary">Custom Model ID</span>
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => { setCustomModel(e.target.value); setToolTestResult(null) }}
                    className={inputClass}
                    placeholder="e.g. my-fine-tuned-model"
                    maxLength={128}
                  />
                </label>
              )}

              {/* Ollama URL (when Ollama selected) */}
              {defaultProvider === 'ollama' && (
                <label className="mb-3 block">
                  <span className="mb-1 block text-sm text-text-secondary">Ollama Base URL</span>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className={inputClass}
                    placeholder="http://localhost:11434"
                  />
                </label>
              )}

              {/* Response Style */}
              <label className="mb-3 block">
                <span className="mb-1 block text-sm text-text-secondary">Response Style</span>
                <select
                  value={responseStyle}
                  onChange={(e) => setResponseStyle(e.target.value as 'concise' | 'detailed')}
                  className={inputClass}
                >
                  <option value="concise">Concise (faster, bullets)</option>
                  <option value="detailed">Detailed (thorough, with context)</option>
                </select>
              </label>

              {/* Test tools */}
              <div className="mb-4 flex items-center gap-2">
                <button
                  onClick={handleTestTools}
                  disabled={toolTesting || (!useCustomModel && !defaultModel) || (useCustomModel && !customModel.trim())}
                  className="rounded border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50"
                >
                  {toolTesting ? 'Testing...' : 'Test Tool Support'}
                </button>
                {toolTestResult && (
                  <span className={`text-xs ${
                    toolTestResult.status === 'supported' ? 'text-success' :
                    toolTestResult.status === 'not_observed' ? 'text-warning' :
                    'text-danger'
                  }`}>
                    {toolTestResult.status === 'supported' ? 'Tool calls supported' :
                     toolTestResult.status === 'not_observed' ? 'Tool calls not observed' :
                     'Tool calls not supported'}
                  </span>
                )}
              </div>

              {/* KB Search / Embeddings */}
              <div className="mb-4 rounded border border-border-subtle bg-surface-0 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text-primary">Knowledge Base Search</span>
                  <span className="text-xs text-text-tertiary">Semantic search over KB files</span>
                </div>
                <p className="text-xs text-text-tertiary mb-3">
                  Enables vector-based retrieval so the AI sees the most relevant KB content for each question.
                </p>

                {/* Embedding provider */}
                <label className="mb-3 block">
                  <span className="mb-1 block text-xs text-text-secondary">Search Engine</span>
                  <select
                    value={embeddingProvider}
                    onChange={(e) => setEmbeddingProvider(e.target.value as EmbeddingProviderOption)}
                    className={inputClass}
                  >
                    <option value="auto">Auto (Ollama if available)</option>
                    <option value="ollama">Ollama</option>
                    <option value="openai">OpenAI</option>
                    <option value="off">Off</option>
                  </select>
                </label>

                {embeddingProvider === 'openai' && (
                  <p className="text-xs text-warning mb-2">
                    KB content will be sent to OpenAI servers for embedding.
                  </p>
                )}

                {/* Embedding model (only when not auto/off) */}
                {(embeddingProvider === 'ollama' || embeddingProvider === 'openai') && (
                  <label className="mb-3 block">
                    <span className="mb-1 block text-xs text-text-secondary">Embedding Model</span>
                    <input
                      type="text"
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      className={inputClass}
                      placeholder={embeddingProvider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'}
                    />
                  </label>
                )}

                {/* Re-index button */}
                {embeddingProvider !== 'off' && (
                  <button
                    onClick={handleReindex}
                    disabled={reindexing}
                    className="rounded border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50"
                  >
                    {reindexing ? 'Re-indexing...' : 'Re-index All Domains'}
                  </button>
                )}
              </div>

              {/* Save */}
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className={secondaryButtonClass}>Cancel</button>
                <button
                  onClick={handleSaveDefaults}
                  disabled={!defaultProvider || (!useCustomModel && !defaultModel) || (useCustomModel && !customModel.trim())}
                  className={primaryButtonClass}
                >
                  Save Defaults
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
