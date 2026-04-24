import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test"

type State = {
  rows: Record<string, unknown>[]
  insertedRow: Record<string, unknown> | null
  updatedRow: Record<string, unknown> | null
}

const state: State = { rows: [], insertedRow: null, updatedRow: null }

function resetState() {
  state.rows = []
  state.insertedRow = null
  state.updatedRow = null
}

mock.module("@crikket/db", () => ({
  db: {
    query: {
      project: {
        findMany: () => Promise.resolve(state.rows),
        findFirst: () =>
          Promise.resolve(state.rows.length > 0 ? state.rows[0] : null),
      },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: () => {
          state.insertedRow = row
          return Promise.resolve([
            { ...row, createdAt: new Date(), updatedAt: new Date() },
          ])
        },
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            state.updatedRow = vals
            return Promise.resolve([
              {
                ...vals,
                id: "p1",
                organizationId: "org-1",
                slug: "alpha",
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ])
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  },
}))

mock.module("@crikket/db/schema/project", () => ({
  project: { _tag: "project" },
}))

mock.module("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ type: "and", args }),
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  desc: (col: unknown) => ({ type: "desc", col }),
}))

mock.module("nanoid", () => ({ nanoid: () => "test-id" }))

beforeAll(() => resetState())
afterEach(() => resetState())

const SLUG_REGEX = /slug/i
const NAME_REGEX = /name/i

function getSvc() {
  return import("../src/lib/project")
}

describe("listProjects", () => {
  it("returns all projects for the org", async () => {
    state.rows = [
      {
        id: "p1",
        name: "Alpha",
        slug: "alpha",
        organizationId: "org-1",
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]
    const { listProjects } = await getSvc()
    const result = await listProjects({ organizationId: "org-1" })
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("Alpha")
  })

  it("returns empty array when no projects", async () => {
    const { listProjects } = await getSvc()
    const result = await listProjects({ organizationId: "org-1" })
    expect(result).toEqual([])
  })
})

describe("createProject", () => {
  it("inserts a project and returns it", async () => {
    const { createProject } = await getSvc()
    const result = await createProject({
      organizationId: "org-1",
      name: "Beta",
      slug: "beta",
    })
    expect(result.name).toBe("Beta")
    expect(state.insertedRow?.organizationId).toBe("org-1")
    expect(state.insertedRow?.slug).toBe("beta")
  })

  it("normalizes slug to lowercase with hyphens", async () => {
    const { createProject } = await getSvc()
    await createProject({
      organizationId: "org-1",
      name: "Test",
      slug: "My App 123",
    })
    expect(state.insertedRow?.slug).toBe("my-app-123")
  })

  it("throws if slug is empty after normalization", async () => {
    const { createProject } = await getSvc()
    await expect(
      createProject({ organizationId: "org-1", name: "Bad", slug: "  ---  " })
    ).rejects.toThrow(SLUG_REGEX)
  })

  it("throws if name is empty", async () => {
    const { createProject } = await getSvc()
    await expect(
      createProject({ organizationId: "org-1", name: "   ", slug: "ok" })
    ).rejects.toThrow(NAME_REGEX)
  })
})

describe("getProjectBySlug", () => {
  it("returns null when not found", async () => {
    const { getProjectBySlug } = await getSvc()
    const result = await getProjectBySlug({
      organizationId: "org-1",
      slug: "missing",
    })
    expect(result).toBeNull()
  })

  it("returns the project when found", async () => {
    state.rows = [
      {
        id: "p1",
        name: "Alpha",
        slug: "alpha",
        organizationId: "org-1",
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]
    const { getProjectBySlug } = await getSvc()
    const result = await getProjectBySlug({
      organizationId: "org-1",
      slug: "alpha",
    })
    expect(result?.id).toBe("p1")
  })
})

describe("updateProject", () => {
  it("updates name", async () => {
    const { updateProject } = await getSvc()
    const result = await updateProject({
      id: "p1",
      organizationId: "org-1",
      name: "New Name",
    })
    expect(state.updatedRow?.name).toBe("New Name")
    expect(result).not.toBeNull()
  })
})

describe("deleteProject", () => {
  it("runs without error", async () => {
    const { deleteProject } = await getSvc()
    await expect(
      deleteProject({ id: "p1", organizationId: "org-1" })
    ).resolves.toBeUndefined()
  })
})
