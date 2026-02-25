/**
 * Domain management — create, configure, and switch between domains.
 */

export { DomainRepository } from './repository.js'
export { DomainRelationshipRepository, DependencyTypeSchema } from './relationships.js'
export type {
  DomainRelationship,
  RelationshipType,
  DependencyType,
  RelationshipPerspective,
  RelationshipView,
  AddRelationshipOptions,
} from './relationships.js'
export { CreateDomainInputSchema, UpdateDomainInputSchema, DomainSchema } from './schemas.js'
export type { Domain, CreateDomainInput, UpdateDomainInput } from './schemas.js'
export { DomainTagRepository, normalizeTagValue, TagKeySchema, TagValueSchema, PREDEFINED_TAG_KEYS } from './tags.js'
export type { DomainTag, PredefinedTagKey } from './tags.js'
