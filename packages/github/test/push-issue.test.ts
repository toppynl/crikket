import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test"

// --- Shared state ---

type State = {
  reportRow: Record<string, unknown> | null
  integrationRow: Record<string, unknown> | null
  issueLinkRow: Record<string, unknown> | null
  insertedIssueLink: Record<string, unknown> | null
  createdIssueNumber: number
  createdIssueUrl: string
  octokitRequests: Array<{ route: string; params: Record<string, unknown> }>
  // Keep as a single stable object — mutate properties, never replace the reference.
  // Module imports hold a reference to this object, so replacement breaks them.
  readonly envOverrides: Record<string, string | undefined>
}

const state: State = {
  reportRow: null,
  integrationRow: null,
  issueLinkRow: null,
  insertedIssueLink: null,
  createdIssueNumber: 42,
  createdIssueUrl: "https://github.com/acme/app/issues/42",
  octokitRequests: [],
  envOverrides: {},
}

function resetState() {
  // Mutate in-place so module imports that hold a reference see the updates.
  const e = state.envOverrides
  for (const key of Object.keys(e)) {
    delete e[key]
  }
  Object.assign(e, {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: Buffer.from("fake-key").toString("base64"),
    STORAGE_BUCKET: "test-bucket",
    STORAGE_REGION: "us-east-1",
    STORAGE_ACCESS_KEY_ID: "key",
    STORAGE_SECRET_ACCESS_KEY: "secret",
    STORAGE_PUBLIC_URL: "https://cdn.example.com",
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
  })

  state.reportRow = {
    id: "report-abc",
    organizationId: "org-1",
    title: "Test bug",
    description: "Something broke",
    priority: "medium",
    tags: ["frontend"],
    url: "https://app.example.com/page",
    deviceInfo: { browser: "Firefox" },
    metadata: { sdkVersion: "0.1.0" },
    attachmentType: "screenshot",
    captureKey: "captures/report-abc.png",
    debuggerKey: "debugger/report-abc.json",
    createdAt: new Date("2026-04-23T12:00:00Z"),
    logs: [{ level: "warn", message: "deprecated API", timestamp: new Date() }],
    networkRequests: [],
    actions: [],
  }
  state.integrationRow = {
    organizationId: "org-1",
    installationId: "inst-1",
    defaultOwner: "acme",
    defaultRepo: "app",
    autoSync: false,
  }
  state.issueLinkRow = null
  state.insertedIssueLink = null
  state.createdIssueNumber = 42
  state.createdIssueUrl = "https://github.com/acme/app/issues/42"
  state.octokitRequests = []
}

// --- Module mocks (must be before imports) ---

mock.module("@crikket/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              table === githubIssueLinkRef
                ? state.issueLinkRow
                  ? [state.issueLinkRow]
                  : []
                : state.integrationRow
                  ? [state.integrationRow]
                  : []
            ),
        }),
      }),
    }),
    query: {
      bugReport: {
        findFirst: () => Promise.resolve(state.reportRow),
      },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        state.insertedIssueLink = row
        return Promise.resolve()
      },
    }),
  },
}))

let githubIssueLinkRef: unknown
let githubIntegrationRef: unknown

mock.module("@crikket/db/schema/github", () => {
  const link = { _tag: "githubIssueLink" }
  const integration = { _tag: "githubIntegration" }
  githubIssueLinkRef = link
  githubIntegrationRef = integration
  return { githubIssueLink: link, githubIntegration: integration }
})

mock.module("@crikket/db/schema/bug-report", () => ({
  bugReport: { _tag: "bugReport" },
}))

mock.module("@crikket/env/server", () => ({
  get env() {
    return state.envOverrides
  },
}))

mock.module("../src/client", () => ({
  getInstallationOctokit: async () => ({
    request: async (route: string, params: Record<string, unknown>) => {
      state.octokitRequests.push({ route, params })
      if (route === "GET /repos/{owner}/{repo}/labels") {
        return { data: [] }
      }
      if (route === "POST /repos/{owner}/{repo}/labels") {
        return { data: {} }
      }
      if (route === "POST /repos/{owner}/{repo}/issues") {
        return {
          data: {
            number: state.createdIssueNumber,
            html_url: state.createdIssueUrl,
          },
        }
      }
      return { data: {} }
    },
  }),
}))

mock.module("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  S3Client: class {
    constructor() {}
  },
}))

mock.module("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_client: unknown, command: { input: { Key: string } }) => {
    return `https://presigned.example.com/${command.input.Key}`
  },
}))

mock.module("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ type: "and", args }),
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  asc: (col: unknown) => ({ type: "asc", col }),
  notExists: (sub: unknown) => ({ type: "notExists", sub }),
  gt: (col: unknown, val: unknown) => ({ type: "gt", col, val }),
  isNull: (col: unknown) => ({ type: "isNull", col }),
}))

mock.module("nanoid", () => ({
  nanoid: () => "mock-nanoid",
}))

// --- Import after mocks ---

beforeAll(() => {
  resetState()
})

afterEach(() => {
  resetState()
})

// Lazy import inside tests to pick up mocks
async function getPushFn() {
  const mod = await import("../src/service/push-issue")
  return mod.pushBugReportToGitHub
}

describe("pushBugReportToGitHub: idempotency", () => {
  it("returns existing issue without calling GitHub when link already exists", async () => {
    state.issueLinkRow = {
      issueUrl: "https://github.com/acme/app/issues/7",
      issueNumber: 7,
    }
    const push = await getPushFn()
    const result = await push("report-abc", "org-1")

    expect(result.alreadyPushed).toBe(true)
    expect(result.issueUrl).toBe("https://github.com/acme/app/issues/7")
    expect(result.issueNumber).toBe(7)
    expect(state.octokitRequests).toHaveLength(0)
  })
})

describe("pushBugReportToGitHub: error cases", () => {
  it("throws when bug report is not found", async () => {
    state.reportRow = null
    const push = await getPushFn()
    await expect(push("report-abc", "org-1")).rejects.toThrow(
      "Bug report not found"
    )
  })

  it("throws when GitHub integration is not configured", async () => {
    state.integrationRow = null
    const push = await getPushFn()
    await expect(push("report-abc", "org-1")).rejects.toThrow(
      "GitHub integration not configured"
    )
  })
})

describe("pushBugReportToGitHub: successful push", () => {
  it("creates a GitHub issue and returns the result", async () => {
    const push = await getPushFn()
    const result = await push("report-abc", "org-1")

    expect(result.alreadyPushed).toBe(false)
    expect(result.issueNumber).toBe(42)
    expect(result.issueUrl).toBe("https://github.com/acme/app/issues/42")
  })

  it("inserts a githubIssueLink row", async () => {
    const push = await getPushFn()
    await push("report-abc", "org-1")

    expect(state.insertedIssueLink).toBeDefined()
    expect(state.insertedIssueLink?.bugReportId).toBe("report-abc")
    expect(state.insertedIssueLink?.organizationId).toBe("org-1")
    expect(state.insertedIssueLink?.issueNumber).toBe(42)
  })

  it("uses static public URL when STORAGE_PUBLIC_URL is set", async () => {
    state.envOverrides.STORAGE_PUBLIC_URL = "https://cdn.example.com"
    const push = await getPushFn()
    await push("report-abc", "org-1")

    const issuePost = state.octokitRequests.find(
      (r) => r.route === "POST /repos/{owner}/{repo}/issues"
    )
    expect(issuePost?.params.body as string).toContain("https://cdn.example.com")
  })

  it("uses presigned URL when STORAGE_PUBLIC_URL is not set", async () => {
    state.envOverrides.STORAGE_PUBLIC_URL = undefined
    const push = await getPushFn()
    await push("report-abc", "org-1")

    const issuePost = state.octokitRequests.find(
      (r) => r.route === "POST /repos/{owner}/{repo}/issues"
    )
    expect(issuePost?.params.body as string).toContain("presigned.example.com")
  })
})
