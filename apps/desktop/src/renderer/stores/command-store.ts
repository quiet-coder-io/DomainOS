/**
 * Zustand store for plugin commands — slash-invocable procedures.
 */

import { create } from 'zustand'
import type { CommandData } from '../../preload/api'

interface CommandState {
  /** Commands available for the current domain. */
  commands: CommandData[]
  /** Map from canonicalSlug → displaySlug for autocomplete. */
  displaySlugs: Record<string, string>
  loading: boolean
  /** Domain ID for which commands are currently loaded. */
  loadedDomainId: string | null

  fetchForDomain: (domainId: string, force?: boolean) => Promise<void>
  clear: () => void
  resolveCommand: (input: string) => CommandData | CommandData[] | null
}

export const useCommandStore = create<CommandState>((set, get) => ({
  commands: [],
  displaySlugs: {},
  loading: false,
  loadedDomainId: null,

  async fetchForDomain(domainId: string, force = false) {
    if (!force && get().loadedDomainId === domainId && get().commands.length > 0) return

    set({ loading: true })
    try {
      const result = await window.domainOS.command.listForDomain(domainId)
      if (result.ok) {
        const cmds = result.value ?? []
        // Build display slug map from enriched command data
        const slugs: Record<string, string> = {}
        for (const cmd of cmds) {
          slugs[cmd.canonicalSlug] = cmd.displaySlug ?? cmd.canonicalSlug
        }
        set({ commands: cmds, displaySlugs: slugs, loadedDomainId: domainId })
      }
    } finally {
      set({ loading: false })
    }
  },

  clear() {
    set({ commands: [], displaySlugs: {}, loadedDomainId: null })
  },

  /**
   * Resolve a user-typed slug (e.g., "/comps" or "/sales:comps") to a command.
   *
   * Returns:
   * - A single CommandData if unambiguous
   * - An array of CommandData[] if multiple matches (collision)
   * - null if no match
   */
  resolveCommand(input: string) {
    const slug = input.startsWith('/') ? input.slice(1) : input
    const { commands, displaySlugs } = get()

    // 1. Exact canonical match
    const exact = commands.find((c) => c.canonicalSlug.toLowerCase() === slug.toLowerCase())
    if (exact) return exact

    // 2. Match by display slug
    const matches: CommandData[] = []
    for (const cmd of commands) {
      const display = displaySlugs[cmd.canonicalSlug] ?? cmd.canonicalSlug
      if (display.toLowerCase() === slug.toLowerCase()) {
        matches.push(cmd)
      }
    }

    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) return matches
    return null
  },
}))
