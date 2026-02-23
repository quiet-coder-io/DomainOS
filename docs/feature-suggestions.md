# Feature Suggestions for DomainOS

An analysis of the current codebase reveals a solid foundation: domain-scoped AI chat, multi-provider LLM support, KB management with tiered staleness, cross-domain relationships, portfolio health briefings, browser ingestion, Gmail/GTasks integrations, deadlines, gap flags, decision logging, and audit trails. The suggestions below target gaps that would strengthen the core loop and expand utility.

---

## 1. Global Search Across Domains

**Problem:** Users must navigate into each domain individually to find information. There is no way to search across all KB files, chat history, or decisions from a single entry point.

**Suggestion:** Add a global search view (or command-palette-style overlay) that queries across:
- KB file contents (all domains)
- Chat message history
- Decision log entries
- Gap flags and deadlines

**Implementation notes:**
- SQLite FTS5 virtual table over `kb_files.content`, `chat_messages.content`, `decisions.decision`
- New IPC channel `search:global` returning ranked results with domain attribution
- Renderer: command palette component (Cmd+K / Ctrl+K) with result grouping by type
- Core: new `packages/core/src/search/` module with FTS index management

**Value:** Turns DomainOS from a per-domain tool into a unified knowledge surface.

---

## 2. Chat History Search and Bookmarks

**Problem:** Past conversations are ephemeral — once a session ends, there is no way to find a specific answer the AI gave previously or bookmark important responses for quick access.

**Suggestion:**
- Add full-text search within a domain's chat history
- Allow users to bookmark/pin individual messages for later reference
- Show a "Saved Messages" panel per domain

**Implementation notes:**
- New `bookmarked` column on `chat_messages` table (migration v11)
- Chat message search via FTS5 (can share infrastructure with global search)
- Renderer: bookmark toggle on `MessageBubble`, new `BookmarkedMessagesPanel` component
- IPC: `chat:search`, `chat:toggle-bookmark`, `chat:list-bookmarks`

**Value:** Conversations become a persistent, searchable knowledge layer rather than a disposable interface.

---

## 3. KB Version History and Rollback

**Problem:** When a KB update proposal is accepted, the previous file content is overwritten. There is no visible history of changes or ability to roll back a bad update. The audit log records events but doesn't store file diffs.

**Suggestion:**
- Store a snapshot of KB file content before each accepted update
- Show a version timeline per KB file with diffs
- Allow one-click rollback to any previous version

**Implementation notes:**
- New `kb_file_versions` table: `(id, kb_file_id, content, content_hash, created_at, source)` where source = `'proposal' | 'manual' | 'scan'`
- Core: `packages/core/src/kb/version-repository.ts`
- Renderer: version history drawer on `KBFileList` items, inline diff view
- Content-addressable storage via existing `computeContentHash()` to deduplicate identical versions

**Value:** Gives users confidence to accept AI-proposed KB updates, knowing they can always undo.

---

## 4. Domain Templates and Presets

**Problem:** Creating a new domain requires manual setup of KB structure, protocols, identity, and escalation triggers from scratch each time. Common use cases (project management, research, personal finance, hiring) share similar patterns.

**Suggestion:**
- Provide built-in domain templates with pre-configured KB scaffolds, protocols, and identity prompts
- Allow users to save any domain as a custom template
- Template selection during `CreateDomainDialog`

**Implementation notes:**
- Core: `packages/core/src/domains/templates.ts` with typed `DomainTemplate` interface
- Built-in templates as static data (no DB, just code)
- Custom templates stored in a new `domain_templates` table or as JSON files in user data
- Extend `CreateDomainDialog` with a template picker step before the form
- `scaffoldKBFiles()` already exists and can be parameterized with template-specific file lists

**Value:** Lowers the barrier to creating new domains and encodes best practices.

---

## 5. Scheduled Briefings with Desktop Notifications

**Problem:** The portfolio health briefing is powerful but entirely manual — users must navigate to the briefing page and click analyze. Stale domains, approaching deadlines, and blocked dependencies go unnoticed until the user checks.

**Suggestion:**
- Allow users to schedule daily/weekly briefing runs (e.g., every morning at 9am)
- Surface critical findings via native desktop notifications (Electron `Notification` API)
- Show an unread badge on the Briefing nav item when new alerts exist

**Implementation notes:**
- Main process: `node-cron` or `setInterval`-based scheduler reading from a `briefing_schedule` config
- Run `computePortfolioHealth()` on schedule; if critical alerts exist, fire `new Notification()`
- Store last briefing result hash to avoid duplicate notifications
- Renderer: badge on sidebar Briefing button when unseen alerts > 0
- Settings: schedule configuration UI (time of day, frequency, enable/disable)

**Value:** Transforms the briefing from a pull-based report into a proactive awareness system.

---

## 6. Conversation Branching

**Problem:** In a long chat session, users sometimes want to explore an alternative approach without losing the current thread. Currently the only option is to continue linearly or start a new session from scratch.

**Suggestion:**
- Allow users to "fork" a conversation at any message, creating a branch that shares history up to that point but diverges afterward
- Show a branch indicator in the chat UI with the ability to switch between branches

**Implementation notes:**
- New `parent_session_id` and `branch_point_message_id` columns on `sessions` table
- When branching, create a new session that references the parent and the branch point
- Chat loading: for a branched session, load parent messages up to branch point + own messages after
- Renderer: branch indicator in `SessionIndicator`, branch-from button on message context menu
- This builds on the existing `SessionRepository` without breaking the current linear model

**Value:** Enables exploratory thinking without commitment, which is especially useful for strategic domains.

---

## 7. Calendar View for Deadlines

**Problem:** Deadlines exist as a flat list per domain. There is no temporal visualization showing upcoming deadlines across all domains, making it hard to spot scheduling conflicts or busy periods.

**Suggestion:**
- Add a calendar view (month/week) showing deadlines from all domains, color-coded by domain
- Optional: two-way sync with Google Calendar via the existing OAuth infrastructure

**Implementation notes:**
- Renderer: new `CalendarPage` or calendar widget on the briefing page
- Lightweight: use a simple CSS grid calendar (no heavy library needed)
- IPC: `deadlines:list-all` to fetch deadlines across all domains within a date range
- Google Calendar sync (optional, later phase): reuse GTasks OAuth flow with `calendar` scope

**Value:** Provides temporal awareness across the entire portfolio.

---

## 8. Domain Archiving

**Problem:** Domains can only be deleted, which is destructive. Completed projects, seasonal domains, or paused work areas should be removable from the active view without losing their data.

**Suggestion:**
- Add an "archive" action that hides a domain from the sidebar and excludes it from health briefings
- Archived domains remain searchable and restorable
- Show an "Archived" section in the sidebar (collapsed by default)

**Implementation notes:**
- New `archived_at` column on `domains` table (nullable timestamp, migration v11)
- `DomainRepository`: add `archive()`, `unarchive()`, filter archived domains from default `list()`
- Health computation: skip archived domains in `computePortfolioHealth()`
- Sidebar: collapsible "Archived" section at the bottom
- IPC: `domain:archive`, `domain:unarchive`

**Value:** Keeps the active workspace clean without data loss.

---

## 9. Keyboard Shortcuts and Command Palette

**Problem:** The app is entirely mouse-driven. Power users managing many domains would benefit from keyboard navigation.

**Suggestion:**
- Implement a command palette (Cmd+K / Ctrl+K) for quick domain switching, view navigation, and action execution
- Add keyboard shortcuts for common actions: new domain, switch domain (Cmd+1-9), toggle sidebar, focus chat input, open briefing

**Implementation notes:**
- Renderer: `CommandPalette` component with fuzzy search over domains, views, and actions
- Use a lightweight hotkey library or raw `useEffect` keyboard listeners
- Store shortcut bindings in localStorage for customization
- Can share the search overlay with Global Search (suggestion #1)

**Value:** Significantly faster navigation for power users.

---

## 10. Multi-Modal KB Support (PDF and Image Ingestion)

**Problem:** KB ingestion only handles text files. Many knowledge domains involve PDFs (contracts, research papers, specifications) and images (diagrams, whiteboards, screenshots) that currently must be manually transcribed.

**Suggestion:**
- Support PDF ingestion: extract text content and store as KB entries
- Support image ingestion: use vision-capable LLMs to describe/transcribe images into text KB entries
- Show thumbnails for image-backed KB files in the file list

**Implementation notes:**
- Core: `packages/core/src/kb/pdf-extractor.ts` using `pdf-parse` (lightweight, no native deps)
- Core: image description via existing LLM provider's vision capabilities (Anthropic and OpenAI both support vision)
- New `source_type` and `source_path` columns on `kb_files` to distinguish text/pdf/image origins
- Renderer: thumbnail rendering for image files, PDF page count display
- Scanner: detect `.pdf`, `.png`, `.jpg` files in KB directories

**Value:** Broadens what counts as "knowledge" within a domain.

---

## 11. Export and Backup

**Problem:** There is no way to export domain data (KB files, chat history, decisions, configurations) for backup or migration. The SQLite database is the single source of truth with no user-facing export.

**Suggestion:**
- Export a domain as a self-contained archive (ZIP) containing KB files, chat history JSON, protocols, decisions, and domain config
- Export portfolio health report as PDF or Markdown
- Full database backup to a user-chosen location

**Implementation notes:**
- Main process: use Node.js `archiver` package for ZIP creation
- Domain export: gather KB files from filesystem + query chat/decisions/protocols from DB + serialize as JSON
- Briefing export: render the existing `BriefingAnalysis` structure to Markdown
- IPC: `domain:export`, `briefing:export`, `backup:create`
- Renderer: export button in domain context menu and briefing page

**Value:** Data portability and disaster recovery.

---

## 12. Intake Source Expansion (Slack, Notion, RSS)

**Problem:** Content ingestion currently supports only browser tabs (via Chrome extension) and Gmail. Many users gather knowledge from Slack, Notion, RSS feeds, and other sources.

**Suggestion:** Add intake adapters for:
- **RSS/Atom feeds**: poll configured feeds and auto-classify new articles
- **Slack**: receive webhook events or poll channels for messages matching configurable keywords
- **Notion**: sync specific Notion pages/databases as KB sources

**Implementation notes:**
- Core: `packages/integrations/src/rss/` — lightweight RSS parser (`rss-parser` package)
- Each adapter implements a common `IntakeSource` interface: `poll() → IntakeItem[]`
- Existing `classifyContent()` handles domain classification for all sources
- Intake repository already has `source_type` and `external_id` columns (migration v6)
- Start with RSS as lowest complexity; Slack/Notion require OAuth flows

**Value:** Makes DomainOS the single funnel for all knowledge inputs.

---

## 13. Protocol Marketplace (Community Sharing)

**Problem:** Already noted as out-of-scope/future in the codebase. Protocols are currently hand-written per domain or shared globally within a single installation. There is no way to discover, import, or share protocols with other users.

**Suggestion:**
- A curated library of protocol templates (bundled or fetched from a public repository)
- Import/export protocols as standalone files
- Eventually: a community registry where users can publish and discover protocols

**Implementation notes:**
- Phase 1: bundle 10-20 high-quality protocol templates covering common patterns (meeting notes protocol, code review protocol, research protocol, etc.)
- Phase 2: import/export as `.protocol.md` files with frontmatter metadata
- Phase 3: public Git-based registry (similar to Homebrew taps)
- Shared protocol infrastructure already exists (`SharedProtocolRepository`)

**Value:** Codifies best practices and reduces the cold-start problem for new domains.

---

## 14. Analytics Dashboard

**Problem:** There is no visibility into usage patterns: which domains get the most chat activity, how KB is growing over time, which tools are used most, or how many proposals are accepted vs. rejected.

**Suggestion:**
- Add an analytics page showing:
  - Chat volume per domain over time
  - KB file count and total size trends
  - Proposal acceptance rate
  - Tool usage frequency (Gmail, GTasks)
  - Deadline completion rate
- Data sourced from existing audit log and chat message tables

**Implementation notes:**
- Core: aggregate query functions over `audit_events`, `chat_messages`, `kb_files`, `deadlines`
- Renderer: new `AnalyticsPage` with simple chart components (lightweight — `recharts` or SVG-based)
- IPC: `analytics:domain-summary`, `analytics:portfolio-trends`
- No new data collection needed — everything derives from existing tables

**Value:** Helps users understand which domains need attention and how they're using the system.

---

## Priority Recommendation

Grouped by impact and implementation complexity:

### High impact, moderate complexity
1. **Global Search** (#1) — foundational for multi-domain usability
2. **KB Version History** (#3) — removes friction from the core propose/accept loop
3. **Domain Archiving** (#8) — small change, big quality-of-life improvement
4. **Keyboard Shortcuts / Command Palette** (#9) — power user retention

### High impact, higher complexity
5. **Scheduled Briefings with Notifications** (#5) — transforms passive tool into proactive assistant
6. **Chat History Search and Bookmarks** (#2) — makes conversations a durable resource
7. **Export and Backup** (#11) — table-stakes for user trust

### Medium impact, worth exploring
8. **Domain Templates** (#4) — reduces onboarding friction
9. **Calendar View** (#7) — natural extension of existing deadlines
10. **Conversation Branching** (#6) — differentiated feature for strategic thinking

### Longer-term bets
11. **Multi-Modal KB** (#10) — broadens the definition of knowledge
12. **Intake Source Expansion** (#12) — network effects from more inputs
13. **Protocol Marketplace** (#13) — community and ecosystem play
14. **Analytics Dashboard** (#14) — useful but not urgent until user base grows
