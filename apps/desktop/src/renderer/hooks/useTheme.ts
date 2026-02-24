import { useCallback, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'domainOS:theme'
const LIGHT_CLASS = 'light'

function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'dark' || raw === 'light') return raw
  } catch {
    // localStorage unavailable — fall through
  }
  return null
}

function getOSTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle(LIGHT_CLASS, theme === 'light')
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    return getStoredTheme() ?? getOSTheme()
  })

  // Apply theme class on mount and changes
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Listen for OS preference changes when no manual override stored
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e: MediaQueryListEvent): void => {
      if (getStoredTheme() !== null) return // manual override — ignore OS change
      const next = e.matches ? 'light' : 'dark'
      setTheme(next)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // localStorage unavailable — still toggle in-memory
      }
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
