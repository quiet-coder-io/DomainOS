/**
 * Domain management — create, configure, and switch between domains.
 */

export { DomainRepository } from './repository.js'
export { DomainRelationshipRepository } from './relationships.js'
export type { DomainRelationship, RelationshipType } from './relationships.js'
export { CreateDomainInputSchema, UpdateDomainInputSchema, DomainSchema } from './schemas.js'
export type { Domain, CreateDomainInput, UpdateDomainInput } from './schemas.js'
