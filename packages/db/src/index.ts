export { createDb, type Database } from "./client.ts"
export {
  countDocumentsByProject,
  createDocument,
  deleteDocument,
  getDocument,
  getDocumentById,
  listDocuments,
  markFailed,
  markIndexed,
  markProcessing,
  replaceDocumentChunks,
  searchChunks,
  type ChunkHit,
  type ChunkInput,
} from "./document.ts"
export { databaseUrl } from "./env.ts"
export {
  addInvite,
  consumeInvite,
  deleteInvite,
  isInvited,
  listInvites,
  normalizeEmail,
} from "./invite.ts"
export {
  createProject,
  deleteProject,
  getProject,
  listProjects,
} from "./project.ts"
export * as schema from "./schema.ts"
export {
  account,
  appMeta,
  chunk,
  document,
  documentStatus,
  invite,
  project,
  session,
  user,
  verification,
  type AppMeta,
  type Chunk,
  type Document,
  type Invite,
  type NewChunk,
  type NewDocument,
  type NewProject,
  type Project,
  type Session,
  type User,
} from "./schema.ts"
