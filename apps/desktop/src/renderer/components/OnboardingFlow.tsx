import { useState, useEffect, useRef } from 'react'
import { useDomainStore, useSettingsStore, useKBStore } from '../stores'
import { LayersIcon } from './icons/LayersIcon'
import { inputClass, primaryButtonClass } from './ui'

type Step = 'welcome' | 'apiKey' | 'createDomain' | 'scanning'

export function OnboardingFlow(): React.JSX.Element {
  const [step, setStep] = useState<Step>('welcome')
  const createdDomainIdRef = useRef<string | null>(null)
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scanResult, setScanResult] = useState<{ added: number } | null>(null)

  // API key state
  const { apiKey, loadApiKey, setApiKey: storeSetApiKey } = useSettingsStore()
  const [localKey, setLocalKey] = useState('')
  const [showReplaceKey, setShowReplaceKey] = useState(false)
  const [apiKeyError, setApiKeyError] = useState('')

  // Domain creation state
  const { domains, createDomain, setActiveDomain } = useDomainStore()
  const { scanAndSync } = useKBStore()
  const [domainName, setDomainName] = useState('')
  const [kbPath, setKbPath] = useState('')
  const [domainError, setDomainError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Scanning state
  const [scanError, setScanError] = useState('')
  const [scanSlow, setScanSlow] = useState(false)

  // Load API key on mount
  useEffect(() => {
    loadApiKey()
  }, [loadApiKey])

  // Cleanup transition timeout on unmount
  useEffect(() => () => {
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)
  }, [])

  // Edge case: domain created via sidebar "+New" while onboarding is mounted
  useEffect(() => {
    if (domains.length === 0) return
    // Only auto-redirect from welcome or apiKey steps
    if (step !== 'welcome' && step !== 'apiKey') return

    const latest = [...domains].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    setActiveDomain(createdDomainIdRef.current ?? latest.id)
  }, [domains, step, setActiveDomain])

  // --- Step handlers ---

  async function handleSaveApiKey(): Promise<void> {
    if (!localKey.trim()) return
    try {
      storeSetApiKey(localKey.trim())
      setApiKeyError('')
      setStep('createDomain')
    } catch {
      setApiKeyError('Failed to save API key. Please try again.')
    }
  }

  async function handleReplaceKey(): Promise<void> {
    if (!localKey.trim()) return
    try {
      storeSetApiKey(localKey.trim())
      setApiKeyError('')
      setShowReplaceKey(false)
      setLocalKey('')
    } catch {
      setApiKeyError('Failed to save API key. Please try again.')
    }
  }

  async function handleBrowse(): Promise<void> {
    const result = await window.domainOS.dialog.openFolder()
    if (result.ok && result.value) {
      setKbPath(result.value)
    }
  }

  async function handleCreateDomain(): Promise<void> {
    const trimmedName = domainName.trim()
    if (!trimmedName) {
      setDomainError('Name is required.')
      return
    }
    if (!kbPath) {
      setDomainError('Please select a KB folder.')
      return
    }

    setSubmitting(true)
    setDomainError('')

    const domain = await createDomain({ name: trimmedName, kbPath })
    if (!domain) {
      setDomainError('Failed to create domain. The path may not exist.')
      setSubmitting(false)
      return
    }

    createdDomainIdRef.current = domain.id
    setStep('scanning')

    // Start scanning
    const slowTimer = setTimeout(() => setScanSlow(true), 5000)
    try {
      const result = await scanAndSync(domain.id)
      setScanResult(result ? { added: result.added } : { added: 0 })
    } catch {
      setScanError('KB scan encountered an error.')
    } finally {
      clearTimeout(slowTimer)
      setScanSlow(false)
      setSubmitting(false)
    }

    // Auto-transition after 1.5s
    transitionTimeoutRef.current = setTimeout(() => {
      transitionTimeoutRef.current = null
      setActiveDomain(createdDomainIdRef.current!)
    }, 1500)
  }

  function handleContinueToChat(): void {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current)
      transitionTimeoutRef.current = null
    }
    setActiveDomain(createdDomainIdRef.current!)
  }

  // --- Render ---

  if (step === 'welcome') {
    return (
      <div className="flex h-full items-center justify-center" data-testid="onboarding-welcome">
        <div className="relative text-center">
          <div className="pointer-events-none absolute inset-0 -m-24 rounded-full bg-accent/5 blur-3xl" />
          <div className="relative">
            <div className="mb-4 flex justify-center text-text-tertiary">
              <LayersIcon />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
              Welcome to DomainOS
            </h1>
            <p className="mt-3 max-w-sm text-sm text-text-tertiary">
              Domain-scoped AI that reads and writes your knowledge base. Your files never leave your machine.
            </p>
            <button
              data-testid="onboarding-get-started"
              onClick={() => setStep('apiKey')}
              className={`mt-6 ${primaryButtonClass}`}
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'apiKey') {
    const hasKey = !!apiKey

    return (
      <div className="flex h-full items-center justify-center" data-testid="onboarding-apikey">
        <div className="w-full max-w-md px-6">
          <h2 className="mb-1 text-lg font-semibold text-text-primary">Anthropic API Key</h2>

          {hasKey && !showReplaceKey ? (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-sm text-green-400">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                API key saved
              </div>
              <button
                data-testid="onboarding-replace-key"
                onClick={() => setShowReplaceKey(true)}
                className="mt-2 text-sm text-text-tertiary hover:text-text-secondary underline"
              >
                Replace key
              </button>
              <div className="mt-6">
                <button
                  data-testid="onboarding-continue-apikey"
                  onClick={() => setStep('createDomain')}
                  className={primaryButtonClass}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : hasKey && showReplaceKey ? (
            <div className="mt-4">
              <input
                type="password"
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                placeholder="sk-ant-..."
                className={inputClass}
                autoFocus
              />
              {apiKeyError && <p className="mt-1 text-xs text-red-400">{apiKeyError}</p>}
              <div className="mt-4 flex gap-2">
                <button onClick={handleReplaceKey} disabled={!localKey.trim()} className={primaryButtonClass}>
                  Save
                </button>
                <button
                  data-testid="onboarding-cancel-replace"
                  onClick={() => { setShowReplaceKey(false); setLocalKey(''); setApiKeyError('') }}
                  className="text-sm text-text-tertiary hover:text-text-secondary"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-4">
                <button
                  data-testid="onboarding-continue-apikey"
                  onClick={() => setStep('createDomain')}
                  className="text-sm text-text-tertiary hover:text-text-secondary underline"
                >
                  Continue without replacing
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <input
                type="password"
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                placeholder="sk-ant-..."
                className={inputClass}
                autoFocus
              />
              <p className="mt-2 text-xs text-text-tertiary">
                Required to chat. Stored locally. Encrypted via Electron safeStorage when available.
              </p>
              {apiKeyError && <p className="mt-1 text-xs text-red-400">{apiKeyError}</p>}
              <div className="mt-4">
                <button
                  data-testid="onboarding-continue-apikey"
                  onClick={handleSaveApiKey}
                  disabled={!localKey.trim()}
                  className={primaryButtonClass}
                >
                  Continue
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (step === 'createDomain') {
    return (
      <div className="flex h-full items-center justify-center" data-testid="onboarding-create">
        <div className="w-full max-w-md px-6">
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Create Your First Domain</h2>

          <label className="mb-3 block">
            <span className="mb-1 block text-sm text-text-secondary">Name</span>
            <input
              type="text"
              value={domainName}
              onChange={(e) => { setDomainName(e.target.value); setDomainError('') }}
              className={inputClass}
              placeholder="e.g. Real Estate"
              autoFocus
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm text-text-secondary">Knowledge Base Folder</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={kbPath}
                readOnly
                className={`flex-1 ${inputClass}`}
                placeholder="/path/to/kb"
              />
              <button
                type="button"
                data-testid="onboarding-browse-folder"
                onClick={handleBrowse}
                className="rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text-secondary hover:bg-surface-3"
              >
                Browse
              </button>
            </div>
          </label>

          {domainError && <p className="mb-3 text-xs text-red-400">{domainError}</p>}

          <button
            data-testid="onboarding-create-submit"
            onClick={handleCreateDomain}
            disabled={submitting || !domainName.trim() || !kbPath}
            className={primaryButtonClass}
          >
            {submitting ? 'Creating...' : 'Create & Start Chatting'}
          </button>
        </div>
      </div>
    )
  }

  // Step: scanning
  return (
    <div className="flex h-full items-center justify-center" data-testid="onboarding-scanning">
      <div className="text-center">
        {scanResult === null && !scanError ? (
          <>
            <div className="mb-3 flex justify-center">
              <svg className="h-6 w-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-sm text-text-secondary">Indexing your KB...</p>
            {scanSlow && (
              <p className="mt-2 text-xs text-text-tertiary">Still scanning... large KBs may take a bit.</p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              {scanError
                ? scanError
                : scanResult!.added > 0
                  ? `Found ${scanResult!.added} file${scanResult!.added === 1 ? '' : 's'}`
                  : 'No files found — you can add files later'}
            </p>
            <button
              data-testid="onboarding-continue-chat"
              onClick={handleContinueToChat}
              className={`mt-4 ${primaryButtonClass}`}
            >
              Continue to chat
            </button>
          </>
        )}
      </div>
    </div>
  )
}
