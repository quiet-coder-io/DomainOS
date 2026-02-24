/**
 * Brainstorm session Zod schemas — session state, ideas, rounds, error codes.
 */

import { z } from 'zod'

// ── Enums ──

export const BrainstormStepSchema = z.enum([
  'setup',
  'technique_selection',
  'execution',
  'synthesis',
  'completed',
])
export type BrainstormStep = z.infer<typeof BrainstormStepSchema>

export const BrainstormPhaseSchema = z.enum(['divergent', 'convergent'])
export type BrainstormPhase = z.infer<typeof BrainstormPhaseSchema>

export const BrainstormErrorCodeSchema = z.enum([
  'NO_SESSION',
  'ILLEGAL_TRANSITION',
  'INSUFFICIENT_IDEAS',
  'CAP_REACHED',
  'UNKNOWN_TECHNIQUE_ID',
  'DB_CONSTRAINT',
])
export type BrainstormErrorCode = z.infer<typeof BrainstormErrorCodeSchema>

// ── Step transition graph ──

/**
 * Valid step transitions. Terminal state 'completed' has no outgoing edges.
 * technique_selection → setup only if ideaCount === 0 (enforced in repository).
 */
export const STEP_TRANSITIONS: Record<BrainstormStep, BrainstormStep[]> = {
  setup: ['technique_selection'],
  technique_selection: ['execution', 'setup'],
  execution: ['technique_selection', 'synthesis'],
  synthesis: ['completed'],
  completed: [],
}

/** Steps that allow pause/resume. */
export const PAUSABLE_STEPS: BrainstormStep[] = [
  'technique_selection',
  'execution',
  'synthesis',
]

// ── Data schemas ──

export const RawIdeaSchema = z.object({
  id: z.string(),
  text: z.string().max(2000),
  techniqueId: z.string(),
  techniqueNameSnapshot: z.string(),
  category: z.string(),
  round: z.number().int().min(1),
  timestamp: z.string(),
}).strict()

export type RawIdea = z.infer<typeof RawIdeaSchema>

export const BrainstormRoundSchema = z.object({
  roundNumber: z.number().int().min(1),
  techniqueId: z.string(),
  techniqueNameSnapshot: z.string(),
  techniqueCategory: z.string(),
  ideaCount: z.number().int().min(0),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
}).strict()

export type BrainstormRound = z.infer<typeof BrainstormRoundSchema>

export const BrainstormSessionSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  sessionId: z.string().nullable(),
  schemaVersion: z.number().int().min(1).default(1),
  step: BrainstormStepSchema,
  phase: BrainstormPhaseSchema,
  isPaused: z.boolean(),
  topic: z.string(),
  goals: z.string(),
  selectedTechniques: z.array(z.string()),
  rounds: z.array(BrainstormRoundSchema),
  rawIdeas: z.array(RawIdeaSchema),
  ideaCount: z.number().int().min(0),
  synthesisPreview: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type BrainstormSession = z.infer<typeof BrainstormSessionSchema>

// ── Input schemas ──

export const CreateBrainstormSessionInputSchema = z.object({
  domainId: z.string().min(1),
  sessionId: z.string().optional(),
  topic: z.string().min(1).max(1000),
  goals: z.string().max(2000).default(''),
})

export type CreateBrainstormSessionInput = z.infer<typeof CreateBrainstormSessionInputSchema>

export const CaptureIdeasInputSchema = z.object({
  ideas: z.array(z.object({
    text: z.string().min(1).max(2000),
  })).min(1).max(50),
  techniqueId: z.string().optional(),
})

export type CaptureIdeasInput = z.infer<typeof CaptureIdeasInputSchema>

// ── Constants ──

export const BRAINSTORM_IDEA_SOFT_CAP = 500
export const BRAINSTORM_SCHEMA_VERSION = 1
