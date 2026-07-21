import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createDb,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  type Database,
} from "@alex/db"

/**
 * Project tenancy against a real Postgres (ADR-0001/ADR-0012). The thing that
 * can't be meaningfully mocked is the `WHERE user_id = …` filter that isolates
 * tenants — so we prove it end-to-end: two users, and neither can see or delete
 * the other's rows through the repository. Needs the dev/CI database up
 * (`pnpm db:up`); rows use random ids scoped to per-run user ids and are cleaned
 * up afterwards.
 */
const url = process.env.DATABASE_URL ?? "postgres://alex:alex@localhost:5434/alex"

describe("project tenancy", () => {
  let db: Database
  let close: () => Promise<void>

  // Unique users per run so parallel/repeat runs never collide.
  const alice = `alice-${randomUUID()}`
  const bob = `bob-${randomUUID()}`
  const created: { userId: string; id: string }[] = []

  const track = (userId: string, id: string) => {
    created.push({ userId, id })
    return id
  }

  beforeAll(() => {
    const conn = createDb(url, 1)
    db = conn.db
    close = conn.close
  })

  afterAll(async () => {
    for (const { userId, id } of created) await deleteProject(db, userId, id)
    await close()
  })

  it("creates a project owned by the user and reads it back", async () => {
    const project = await createProject(db, {
      userId: alice,
      name: "Alice's research",
      description: "benchmarks",
    })
    track(alice, project.id)

    expect(project.userId).toBe(alice)
    expect(project.name).toBe("Alice's research")

    const fetched = await getProject(db, alice, project.id)
    expect(fetched?.id).toBe(project.id)
    expect(fetched?.description).toBe("benchmarks")
  })

  it("defaults description to empty string when omitted", async () => {
    const project = await createProject(db, { userId: alice, name: "No desc" })
    track(alice, project.id)
    expect(project.description).toBe("")
  })

  it("lists only the authenticated user's projects", async () => {
    const a1 = await createProject(db, { userId: alice, name: "A one" })
    const a2 = await createProject(db, { userId: alice, name: "A two" })
    const b1 = await createProject(db, { userId: bob, name: "B one" })
    track(alice, a1.id)
    track(alice, a2.id)
    track(bob, b1.id)

    const aliceIds = (await listProjects(db, alice)).map((p) => p.id)
    expect(aliceIds).toEqual(expect.arrayContaining([a1.id, a2.id]))
    expect(aliceIds).not.toContain(b1.id)

    const bobIds = (await listProjects(db, bob)).map((p) => p.id)
    expect(bobIds).toContain(b1.id)
    expect(bobIds).not.toContain(a1.id)
  })

  it("won't return another user's project by id (no cross-tenant read)", async () => {
    const bobProject = await createProject(db, { userId: bob, name: "Bob only" })
    track(bob, bobProject.id)

    // Alice guesses Bob's real id — she still gets nothing.
    expect(await getProject(db, alice, bobProject.id)).toBeUndefined()
    // And it's genuinely there for its owner.
    expect((await getProject(db, bob, bobProject.id))?.id).toBe(bobProject.id)
  })

  it("won't delete another user's project (no cross-tenant mutation)", async () => {
    const bobProject = await createProject(db, { userId: bob, name: "Keep me" })
    track(bob, bobProject.id)

    // Alice tries to delete Bob's project — it must survive.
    await deleteProject(db, alice, bobProject.id)
    expect((await getProject(db, bob, bobProject.id))?.id).toBe(bobProject.id)
  })
})
