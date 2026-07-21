import { randomUUID } from "node:crypto"

import { and, desc, eq } from "drizzle-orm"

import type { Database } from "./client.ts"
import { project, type Project } from "./schema.ts"

/**
 * Project queries (ADR-0001 tenancy). Like the invite helpers, these live in the
 * db package so the query builders (`eq`/`and`/…) and the `project` table come
 * from one drizzle-orm instance — importing them across package boundaries
 * yields two peer-variant copies whose column types don't unify.
 *
 * Every read and mutation is filtered by `userId`: a project id alone never
 * authorizes access. `getProject`/`updateProject`/`deleteProject` scope on
 * `(id, userId)` together, so one user can't touch another's rows even with a
 * guessed id — they simply see nothing.
 */

/** Create a project owned by `userId`. Returns the full inserted row. */
export async function createProject(
  db: Database,
  input: { userId: string; name: string; description?: string },
): Promise<Project> {
  const [row] = await db
    .insert(project)
    .values({
      id: randomUUID(),
      userId: input.userId,
      name: input.name,
      description: input.description ?? "",
    })
    .returning()
  if (!row) throw new Error("createProject: insert returned no row")
  return row
}

/** All of `userId`'s projects, most-recently-updated first. */
export async function listProjects(
  db: Database,
  userId: string,
): Promise<Project[]> {
  return db
    .select()
    .from(project)
    .where(eq(project.userId, userId))
    .orderBy(desc(project.updatedAt))
}

/**
 * A single project, but only if it belongs to `userId`. Returns undefined for a
 * missing id *and* for another user's id — the caller can't tell the two apart,
 * which is the point (no existence oracle across tenants).
 */
export async function getProject(
  db: Database,
  userId: string,
  projectId: string,
): Promise<Project | undefined> {
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
    .limit(1)
  return row
}

/** Delete a project row (used by integration tests to clean up). */
export async function deleteProject(
  db: Database,
  userId: string,
  projectId: string,
): Promise<void> {
  await db
    .delete(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
}
