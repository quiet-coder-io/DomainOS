/**
 * Deterministic synthesizer: RawIdea[] → BrainstormPayload.
 *
 * Groups ideas by keyword overlap + technique category, merges small clusters,
 * ranks by cluster size + round diversity, produces up to 10 options.
 *
 * Fully deterministic: same input → same output.
 */

import type { RawIdea } from './schemas.js'
import type { BrainstormPayload } from '../advisory/schemas.js'

// ── Stopwords for label generation ──

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this',
  'these', 'those', 'it', 'its', 'we', 'they', 'them', 'their', 'our',
  'your', 'my', 'his', 'her', 'he', 'she', 'you', 'me', 'us', 'what',
  'which', 'who', 'whom', 'up', 'about', 'also', 'like', 'get', 'got',
  'make', 'made', 'use', 'using', 'way', 'thing', 'things', 'much',
  'many', 'well', 'even', 'still', 'going', 'new',
])

const ULTRA_COMMON = new Set([
  'improve', 'better', 'optimize', 'enhance', 'increase', 'reduce',
  'create', 'build', 'develop', 'implement', 'add', 'change', 'update',
  'process', 'system', 'approach', 'solution', 'option', 'idea',
  'focus', 'consider', 'ensure', 'provide', 'support', 'help',
])

// ── Tokenization ──

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

function getNgrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return []
  const ngrams: string[] = []
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '))
  }
  return ngrams
}

// ── Clustering ──

interface Cluster {
  ideas: RawIdea[]
  tokens: Map<string, number>
  categories: Set<string>
  rounds: Set<number>
}

function ideaSimilarity(tokensA: string[], tokensB: Map<string, number>): number {
  let overlap = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++
  }
  return overlap
}

function clusterIdeas(ideas: RawIdea[]): Cluster[] {
  if (ideas.length === 0) return []

  const clusters: Cluster[] = []

  for (const idea of ideas) {
    const ideaTokens = tokenize(idea.text)
    let bestCluster: Cluster | null = null
    let bestScore = 0

    for (const cluster of clusters) {
      // Similarity: keyword overlap + same category bonus
      let score = ideaSimilarity(ideaTokens, cluster.tokens)
      if (cluster.categories.has(idea.category)) score += 2

      if (score > bestScore && score >= 2) {
        bestScore = score
        bestCluster = cluster
      }
    }

    if (bestCluster) {
      bestCluster.ideas.push(idea)
      for (const t of ideaTokens) {
        bestCluster.tokens.set(t, (bestCluster.tokens.get(t) ?? 0) + 1)
      }
      bestCluster.categories.add(idea.category)
      bestCluster.rounds.add(idea.round)
    } else {
      const tokenMap = new Map<string, number>()
      for (const t of ideaTokens) {
        tokenMap.set(t, (tokenMap.get(t) ?? 0) + 1)
      }
      clusters.push({
        ideas: [idea],
        tokens: tokenMap,
        categories: new Set([idea.category]),
        rounds: new Set([idea.round]),
      })
    }
  }

  return clusters
}

/**
 * Merge clusters with < 3 ideas into nearest neighbor.
 */
function mergeSmalClusters(clusters: Cluster[]): Cluster[] {
  const MIN_SIZE = 3

  // Sort by size descending for stable merging
  clusters.sort((a, b) => b.ideas.length - a.ideas.length)

  const merged: Cluster[] = []
  const small: Cluster[] = []

  for (const c of clusters) {
    if (c.ideas.length >= MIN_SIZE) {
      merged.push(c)
    } else {
      small.push(c)
    }
  }

  // Merge small clusters into nearest large cluster
  for (const sc of small) {
    if (merged.length === 0) {
      merged.push(sc)
      continue
    }

    let bestIdx = 0
    let bestScore = -1

    for (let i = 0; i < merged.length; i++) {
      let score = 0
      for (const [token, count] of sc.tokens) {
        if (merged[i].tokens.has(token)) score += count
      }
      // Category overlap bonus
      for (const cat of sc.categories) {
        if (merged[i].categories.has(cat)) score += 2
      }

      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    // Merge into best match
    for (const idea of sc.ideas) {
      merged[bestIdx].ideas.push(idea)
    }
    for (const [token, count] of sc.tokens) {
      merged[bestIdx].tokens.set(token, (merged[bestIdx].tokens.get(token) ?? 0) + count)
    }
    for (const cat of sc.categories) {
      merged[bestIdx].categories.add(cat)
    }
    for (const r of sc.rounds) {
      merged[bestIdx].rounds.add(r)
    }
  }

  return merged
}

// ── Label generation ──

/**
 * Deterministic labeler: extract top n-grams by frequency, penalize ultra-common words.
 * Fallback: "Option {N}: {first_idea_truncated}" — never nonsense.
 */
function labelCluster(cluster: Cluster, index: number): string {
  // Collect all tokens from ideas in this cluster
  const allTokens: string[] = []
  for (const idea of cluster.ideas) {
    allTokens.push(...tokenize(idea.text))
  }

  // Count 1-grams, 2-grams, 3-grams
  const ngramCounts = new Map<string, number>()

  for (const t of allTokens) {
    if (!ULTRA_COMMON.has(t)) {
      ngramCounts.set(t, (ngramCounts.get(t) ?? 0) + 1)
    }
  }

  // 2-grams from each idea
  for (const idea of cluster.ideas) {
    const tokens = tokenize(idea.text).filter((t) => !ULTRA_COMMON.has(t))
    for (const ng of getNgrams(tokens, 2)) {
      ngramCounts.set(ng, (ngramCounts.get(ng) ?? 0) + 2) // Weight bigrams higher
    }
    for (const ng of getNgrams(tokens, 3)) {
      ngramCounts.set(ng, (ngramCounts.get(ng) ?? 0) + 3) // Weight trigrams highest
    }
  }

  // Sort by frequency, pick top
  const sorted = [...ngramCounts.entries()]
    .filter(([, count]) => count >= 2) // Must appear at least twice
    .sort((a, b) => b[1] - a[1])

  if (sorted.length > 0) {
    // Pick the shortest high-frequency phrase
    const topScore = sorted[0][1]
    const topCandidates = sorted
      .filter(([, count]) => count >= topScore * 0.7)
      .sort((a, b) => {
        // Prefer longer n-grams (more descriptive), then higher frequency
        const aWords = a[0].split(' ').length
        const bWords = b[0].split(' ').length
        if (bWords !== aWords) return bWords - aWords
        return b[1] - a[1]
      })

    if (topCandidates.length > 0) {
      // Title case
      const label = topCandidates[0][0]
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')

      if (label.length >= 3 && label.length <= 80) {
        return label
      }
    }
  }

  // Fallback: use first idea text, truncated
  const firstIdea = cluster.ideas[0]?.text ?? ''
  const truncated = firstIdea.length > 60 ? firstIdea.slice(0, 57) + '...' : firstIdea
  return `Option ${index + 1}: ${truncated}`
}

// ── Ranking ──

function rankClusters(clusters: Cluster[]): Cluster[] {
  return [...clusters].sort((a, b) => {
    // Primary: cluster size (more ideas = more important theme)
    const sizeDiff = b.ideas.length - a.ideas.length
    if (sizeDiff !== 0) return sizeDiff

    // Secondary: round diversity (ideas from multiple rounds = more validated)
    const roundDiff = b.rounds.size - a.rounds.size
    if (roundDiff !== 0) return roundDiff

    // Tertiary: category diversity
    return b.categories.size - a.categories.size
  })
}

// ── Main synthesizer ──

export interface SynthesizeOptions {
  topic: string
  techniquesUsed?: string[]
  roundCount?: number
}

/**
 * Deterministic converter: RawIdea[] → BrainstormPayload.
 * Same input always produces the same output.
 */
export function synthesize(ideas: RawIdea[], options: SynthesizeOptions): BrainstormPayload {
  // 1. Cluster ideas
  let clusters = clusterIdeas(ideas)

  // 2. Merge small clusters
  clusters = mergeSmalClusters(clusters)

  // 3. Rank by size + diversity
  clusters = rankClusters(clusters)

  // 4. Take top 10
  const topClusters = clusters.slice(0, 10)

  // 5. Generate options
  const brainstormOptions = topClusters.map((cluster, i) => {
    const label = labelCluster(cluster, i)
    const descriptions = cluster.ideas
      .slice(0, 5) // Max 5 ideas per option description
      .map((idea) => idea.text)
    const description = descriptions.join('. ')

    const pros = cluster.ideas.length > 1
      ? `Supported by ${cluster.ideas.length} ideas across ${cluster.rounds.size} round(s)`
      : undefined

    const action = cluster.ideas[0]?.text
      ? cluster.ideas[0].text.length > 200
        ? cluster.ideas[0].text.slice(0, 197) + '...'
        : cluster.ideas[0].text
      : undefined

    return {
      title: label.slice(0, 200),
      description: description.slice(0, 2000),
      pros: pros?.slice(0, 500),
      action: action?.slice(0, 500),
    }
  })

  // 6. Recommendation from highest-ranked cluster
  const recommendation = brainstormOptions.length > 0
    ? `Focus on "${brainstormOptions[0].title}" — the strongest theme with the most convergent ideas.`
    : 'No clear recommendation emerged. Consider expanding the brainstorm.'

  // 7. Contrarian view from most novel/unconventional cluster
  // Find cluster with fewest ideas but widest category spread (most unconventional)
  let contrarianView: string | undefined
  if (topClusters.length >= 2) {
    const unconventional = [...topClusters]
      .sort((a, b) => {
        // Prefer small + diverse = unconventional
        const aScore = a.categories.size / Math.max(a.ideas.length, 1)
        const bScore = b.categories.size / Math.max(b.ideas.length, 1)
        return bScore - aScore
      })[0]

    if (unconventional && unconventional !== topClusters[0]) {
      const label = labelCluster(unconventional, topClusters.indexOf(unconventional))
      contrarianView = `Consider "${label}" as an unconventional angle — it draws from ${unconventional.categories.size} different technique categories.`
    }
  }

  // 8. Assumptions from first-principles/what-if technique outputs
  const assumptionIdeas = ideas.filter((idea) =>
    idea.category === 'disruptive' || idea.techniqueId.includes('first-principles') || idea.techniqueId.includes('what-if'),
  )
  const assumptions = assumptionIdeas.length > 0
    ? assumptionIdeas.slice(0, 10).map((idea) => idea.text.slice(0, 500))
    : undefined

  // 9. Notes with session summary
  const techniques = [...new Set(ideas.map((i) => i.techniqueNameSnapshot))]
  const rounds = [...new Set(ideas.map((i) => i.round))]
  const notes = [
    `Session summary: ${ideas.length} ideas generated across ${rounds.length} round(s) using ${techniques.length} technique(s).`,
    techniques.length > 0 ? `Techniques: ${techniques.join(', ')}.` : '',
    options.topic ? `Topic: ${options.topic}.` : '',
  ].filter(Boolean).join(' ').slice(0, 2000)

  return {
    topic: options.topic.slice(0, 1000),
    options: brainstormOptions.length > 0
      ? brainstormOptions
      : [{ title: 'General Ideas', description: ideas.map((i) => i.text).join('. ').slice(0, 2000) }],
    recommendation: recommendation.slice(0, 2000),
    contrarian_view: contrarianView?.slice(0, 1000),
    assumptions,
    notes,
  }
}
