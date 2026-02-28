/**
 * Skills — user-activated procedural expertise for per-message prompt injection.
 */

export { SkillRepository } from './repository.js'
export type { EffectiveSkillReason, EffectiveSkillResult, SkillListItem } from './repository.js'
export {
  CreateSkillInputSchema,
  UpdateSkillInputSchema,
  SkillSchema,
  SkillOutputFormatSchema,
} from './schemas.js'
export type {
  Skill,
  CreateSkillInput,
  UpdateSkillInput,
  SkillOutputFormat,
} from './schemas.js'

export { skillToMarkdown, markdownToSkillInput } from './serialization.js'
