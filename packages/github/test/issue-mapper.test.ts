import { describe, expect, it } from "bun:test"
import { type BugReportForIssue, mapBugReportToIssue } from "../src/issue-mapper"

const APP_URL = "https://app.example.com"

function makeReport(overrides: Partial<BugReportForIssue> = {}): BugReportForIssue {
  return {
    id: "report-123",
    title: "Button does nothing",
    description: "Clicking submit has no effect.",
    priority: "high",
    tags: ["ui", "regression"],
    url: "https://app.example.com/dashboard",
    deviceInfo: { browser: "Chrome 120", os: "macOS 14", viewport: "1440x900" },
    metadata: { duration: "00:01:23", sdkVersion: "0.1.0", submittedVia: "widget" },
    attachmentType: "screenshot",
    captureUrl: "https://s3.example.com/capture.png?X-Amz-Expires=31536000",
    debuggerUrl: "https://s3.example.com/debug.json?X-Amz-Expires=31536000",
    createdAt: new Date("2026-04-23T10:00:00.000Z"),
    logs: [],
    networkRequests: [],
    actions: [],
    ...overrides,
  }
}

describe("mapBugReportToIssue: title", () => {
  it("uses report title when present", () => {
    const { title } = mapBugReportToIssue(makeReport(), APP_URL)
    expect(title).toBe("Button does nothing")
  })

  it("falls back to page URL when title is null", () => {
    const { title } = mapBugReportToIssue(makeReport({ title: null }), APP_URL)
    expect(title).toBe("Bug report from https://app.example.com/dashboard")
  })

  it("falls back to report ID when title and URL are both null", () => {
    const { title } = mapBugReportToIssue(
      makeReport({ title: null, url: null }),
      APP_URL
    )
    expect(title).toBe("Bug report report-123")
  })
})

describe("mapBugReportToIssue: labels", () => {
  it("includes priority label for non-none priorities", () => {
    const { labels } = mapBugReportToIssue(makeReport({ priority: "high" }), APP_URL)
    expect(labels).toContain("priority: high")
  })

  it("omits priority label when priority is none", () => {
    const { labels } = mapBugReportToIssue(makeReport({ priority: "none" }), APP_URL)
    expect(labels).not.toContain("priority: none")
  })

  it("includes tags as labels", () => {
    const { labels } = mapBugReportToIssue(makeReport(), APP_URL)
    expect(labels).toContain("ui")
    expect(labels).toContain("regression")
  })

  it("includes priority label color", () => {
    const { labelColors } = mapBugReportToIssue(makeReport({ priority: "critical" }), APP_URL)
    expect(labelColors["priority: critical"]).toBe("b60205")
  })
})

describe("mapBugReportToIssue: issue body — header", () => {
  it("includes forwarded header with report ID and timestamp", () => {
    const { body } = mapBugReportToIssue(makeReport(), APP_URL)
    expect(body).toContain("`report-123`")
    expect(body).toContain("2026-04-23T10:00:00.000Z")
  })

  it("includes Crikket deep-link in header", () => {
    const { body } = mapBugReportToIssue(makeReport(), APP_URL)
    expect(body).toContain(`${APP_URL}/s/report-123`)
  })
})

describe("mapBugReportToIssue: issue body — description", () => {
  it("includes description section when present", () => {
    const { body } = mapBugReportToIssue(makeReport(), APP_URL)
    expect(body).toContain("## Description")
    expect(body).toContain("Clicking submit has no effect.")
  })

  it("omits description section when null", () => {
    const { body } = mapBugReportToIssue(makeReport({ description: null }), APP_URL)
    expect(body).not.toContain("## Description")
  })
})

describe("mapBugReportToIssue: issue body — context table", () => {
  it("renders context table with all fields", () => {
    const { body } = mapBugReportToIssue(makeReport(), APP_URL)
    expect(body).toContain("## Context")
    expect(body).toContain("| Browser | Chrome 120 |")
    expect(body).toContain("| OS | macOS 14 |")
    expect(body).toContain("| Viewport | 1440x900 |")
    expect(body).toContain("| Priority | high |")
    expect(body).toContain("| Tags | ui, regression |")
    expect(body).toContain("| SDK version | 0.1.0 |")
  })

  it("falls back to — for missing device info fields", () => {
    const { body } = mapBugReportToIssue(
      makeReport({ deviceInfo: {} }),
      APP_URL
    )
    expect(body).toContain("| Browser | — |")
  })

  it("shows — for empty tags", () => {
    const { body } = mapBugReportToIssue(makeReport({ tags: [] }), APP_URL)
    expect(body).toContain("| Tags | — |")
  })
})

describe("mapBugReportToIssue: issue body — artifacts", () => {
  it("renders artifact links when URLs are present", () => {
    const { body } = mapBugReportToIssue(makeReport(), APP_URL)
    expect(body).toContain("## Artifacts")
    expect(body).toContain("https://s3.example.com/capture.png")
    expect(body).toContain("https://s3.example.com/debug.json")
  })

  it("shows 'not available' when capture URL is null", () => {
    const { body } = mapBugReportToIssue(makeReport({ captureUrl: null }), APP_URL)
    expect(body).toContain("not available")
  })

  it("omits artifacts section when both URLs are null", () => {
    const { body } = mapBugReportToIssue(
      makeReport({ captureUrl: null, debuggerUrl: null }),
      APP_URL
    )
    expect(body).not.toContain("## Artifacts")
  })

  it("includes presigned URL expiry note", () => {
    const { body } = mapBugReportToIssue(makeReport(), APP_URL)
    expect(body).toContain("presigned S3 URLs")
  })

  it("labels capture as Recording for video attachment type", () => {
    const { body } = mapBugReportToIssue(
      makeReport({ attachmentType: "video" }),
      APP_URL
    )
    expect(body).toContain("Recording (.webm)")
  })
})

describe("mapBugReportToIssue: issue body — reproduction steps", () => {
  it("omits section when actions array is empty", () => {
    const { body } = mapBugReportToIssue(makeReport({ actions: [] }), APP_URL)
    expect(body).not.toContain("## Reproduction steps")
  })

  it("renders numbered action list", () => {
    const { body } = mapBugReportToIssue(
      makeReport({
        actions: [
          { type: "click", target: "button#submit", timestamp: new Date() },
          { type: "input", target: null, timestamp: new Date() },
        ],
      }),
      APP_URL
    )
    expect(body).toContain("## Reproduction steps")
    expect(body).toContain("1. click on button#submit")
    expect(body).toContain("2. input")
  })
})

describe("mapBugReportToIssue: issue body — console logs", () => {
  it("omits section when logs array is empty", () => {
    const { body } = mapBugReportToIssue(makeReport({ logs: [] }), APP_URL)
    expect(body).not.toContain("## Console logs")
  })

  it("renders log entries in a code block", () => {
    const ts = new Date("2026-04-23T10:01:00.000Z")
    const { body } = mapBugReportToIssue(
      makeReport({
        logs: [{ level: "error", message: "Cannot read property", timestamp: ts }],
      }),
      APP_URL
    )
    expect(body).toContain("## Console logs")
    expect(body).toContain("ERROR: Cannot read property")
    expect(body).toContain("```")
  })

  it("truncates messages longer than 400 characters", () => {
    const longMsg = "x".repeat(450)
    const { body } = mapBugReportToIssue(
      makeReport({
        logs: [{ level: "info", message: longMsg, timestamp: new Date() }],
      }),
      APP_URL
    )
    expect(body).toContain("…")
    expect(body).not.toContain("x".repeat(401))
  })
})

describe("mapBugReportToIssue: issue body — network requests", () => {
  it("omits section when networkRequests array is empty", () => {
    const { body } = mapBugReportToIssue(
      makeReport({ networkRequests: [] }),
      APP_URL
    )
    expect(body).not.toContain("Network requests")
  })

  it("renders collapsed details with method, status, duration, url", () => {
    const { body } = mapBugReportToIssue(
      makeReport({
        networkRequests: [
          {
            method: "POST",
            url: "https://api.example.com/submit",
            status: 500,
            duration: 234,
          },
        ],
      }),
      APP_URL
    )
    expect(body).toContain("<details>")
    expect(body).toContain("Network requests")
    expect(body).toContain("| POST | 500 | 234 |")
    expect(body).toContain("https://api.example.com/submit")
  })
})
