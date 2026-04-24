import { createContext } from "@crikket/api/context"
import {
  buildRpcRateLimitErrorResponse,
  evaluateRpcRateLimit,
} from "@crikket/api/rate-limit"
import { appRouter } from "@crikket/api/routers/index"
import { auth } from "@crikket/auth"
import { runBugReportIngestionPass } from "@crikket/bug-reports/lib/ingestion-jobs"
import { runStalePendingBugReportCleanupPass } from "@crikket/bug-reports/lib/orphan-cleanup"
import { runArtifactCleanupPass } from "@crikket/bug-reports/lib/storage"
import { env } from "@crikket/env/server"
import { runGitHubAutoSyncPass } from "@crikket/github/service/auto-sync"
import { handleGitHubWebhook } from "@crikket/github/webhooks/handler"
import { runGitHubWebhookProcessorPass } from "@crikket/github/webhooks/processor"
import { OpenAPIHandler } from "@orpc/openapi/fetch"
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins"
import { onError } from "@orpc/server"
import { RPCHandler } from "@orpc/server/fetch"
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { handleCaptureFinalize } from "./capture/finalize-route"
import { handleCaptureToken } from "./capture/token-route"
import { handleCaptureUploadSession } from "./capture/upload-session-route"

const app = new Hono()
const allowedCorsOrigins = env.CORS_ORIGINS
const fallbackCorsOrigin = allowedCorsOrigins[0] ?? env.BETTER_AUTH_URL
const captureShareOrigin = allowedCorsOrigins[0] ?? env.BETTER_AUTH_URL
const MAX_RPC_REQUEST_BODY_BYTES = 110 * 1024 * 1024
const BUG_REPORT_INGESTION_INTERVAL_MS = 60 * 1000
const BUG_REPORT_ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const STORAGE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const GITHUB_WEBHOOK_PROCESSOR_INTERVAL_MS = 30 * 1000
const GITHUB_AUTO_SYNC_INTERVAL_MS = 30 * 1000
type RateLimitHeaders = Record<string, string>

function parseHeaderNumber(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildPayloadTooLargeResponse(maxBytes: number): Response {
  return new Response(
    JSON.stringify({
      code: "PAYLOAD_TOO_LARGE",
      message: `Request body exceeds ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`,
    }),
    {
      status: 413,
      headers: {
        "content-type": "application/json",
      },
    }
  )
}

function selectStrictestRateLimitHeaders(
  current: RateLimitHeaders,
  incoming: RateLimitHeaders
): RateLimitHeaders {
  if (Object.keys(current).length === 0) {
    return incoming
  }

  if (Object.keys(incoming).length === 0) {
    return current
  }

  const currentLimit = parseHeaderNumber(current["x-ratelimit-limit"])
  const incomingLimit = parseHeaderNumber(incoming["x-ratelimit-limit"])
  const currentRemaining = parseHeaderNumber(current["x-ratelimit-remaining"])
  const incomingRemaining = parseHeaderNumber(incoming["x-ratelimit-remaining"])

  if (
    currentLimit === null ||
    incomingLimit === null ||
    currentRemaining === null ||
    incomingRemaining === null ||
    currentLimit <= 0 ||
    incomingLimit <= 0
  ) {
    return incoming
  }

  const currentRatio = currentRemaining / currentLimit
  const incomingRatio = incomingRemaining / incomingLimit

  if (incomingRatio < currentRatio) {
    return incoming
  }

  if (incomingRatio === currentRatio && incomingRemaining < currentRemaining) {
    return incoming
  }

  return current
}

app.use(logger())
app.use(
  "/*",
  cors({
    origin: (origin, c) => {
      if (
        (c.req.path === "/api/embed/capture-token" ||
          c.req.path === "/api/embed/bug-report-upload-session" ||
          c.req.path === "/api/embed/bug-report-finalize") &&
        origin.trim().length > 0
      ) {
        return origin
      }
      if (allowedCorsOrigins.includes(origin)) return origin
      if (origin.startsWith("chrome-extension://")) return origin
      return fallbackCorsOrigin
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "x-crikket-capture-finalize-token",
      "x-crikket-capture-token",
      "x-crikket-public-key",
    ],
    credentials: true,
  })
)

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
app.post("/api/embed/capture-token", (c) => {
  return handleCaptureToken({
    request: c.req.raw,
  })
})
app.post("/api/embed/bug-report-upload-session", (c) => {
  return handleCaptureUploadSession({
    request: c.req.raw,
  })
})
app.post("/api/embed/bug-report-finalize", (c) => {
  return handleCaptureFinalize({
    request: c.req.raw,
    shareOrigin: captureShareOrigin,
  })
})

app.post("/api/webhooks/github", (c) => handleGitHubWebhook(c.req.raw))

app.get("/api/github/callback", (c) => {
  const installationId = c.req.query("installation_id")
  const setupAction = c.req.query("setup_action")
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL
  const redirectUrl = new URL("/settings/integrations/github", appUrl)
  if (installationId)
    redirectUrl.searchParams.set("installation_id", installationId)
  if (setupAction) redirectUrl.searchParams.set("setup_action", setupAction)
  return c.redirect(redirectUrl.toString())
})

if (env.BACKGROUND_JOBS === "native") {
  const cleanupInterval = setInterval(() => {
    runArtifactCleanupPass({ limit: 50 }).catch((error: unknown) => {
      console.error("[artifact-cleanup] failed scheduled cleanup pass", error)
    })
  }, STORAGE_CLEANUP_INTERVAL_MS)

  cleanupInterval.unref?.()

  const ingestionInterval = setInterval(() => {
    runBugReportIngestionPass({ limit: 10 }).catch((error: unknown) => {
      console.error(
        "[bug-report-ingestion] failed scheduled ingestion pass",
        error
      )
    })
  }, BUG_REPORT_INGESTION_INTERVAL_MS)

  ingestionInterval.unref?.()

  const orphanCleanupInterval = setInterval(() => {
    runStalePendingBugReportCleanupPass({ limit: 10 }).catch(
      (error: unknown) => {
        console.error(
          "[bug-report-orphan-cleanup] failed scheduled orphan cleanup pass",
          error
        )
      }
    )
  }, BUG_REPORT_ORPHAN_CLEANUP_INTERVAL_MS)

  orphanCleanupInterval.unref?.()
}

const githubWebhookProcessorInterval = setInterval(() => {
  runGitHubWebhookProcessorPass({ limit: 20 }).catch((error) => {
    console.error("[github-webhook-processor] failed scheduled pass", error)
  })
}, GITHUB_WEBHOOK_PROCESSOR_INTERVAL_MS)

githubWebhookProcessorInterval.unref?.()

const githubAutoSyncInterval = setInterval(() => {
  runGitHubAutoSyncPass({ limit: 20 }).catch((error) => {
    console.error("[github-auto-sync] failed scheduled pass", error)
  })
}, GITHUB_AUTO_SYNC_INTERVAL_MS)

githubAutoSyncInterval.unref?.()

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

app.use("/*", async (c, next) => {
  if (c.req.method === "POST" && c.req.path.startsWith("/rpc/")) {
    const contentLengthHeader = c.req.raw.headers.get("content-length")
    const contentLength = parseHeaderNumber(contentLengthHeader ?? undefined)

    if (
      contentLengthHeader !== null &&
      contentLength !== null &&
      contentLength > MAX_RPC_REQUEST_BODY_BYTES
    ) {
      return buildPayloadTooLargeResponse(MAX_RPC_REQUEST_BODY_BYTES)
    }
  }

  const ipRateLimitDecision = await evaluateRpcRateLimit(c.req.raw, {
    skipUser: true,
  })
  if (!ipRateLimitDecision.allowed) {
    return buildRpcRateLimitErrorResponse(ipRateLimitDecision)
  }
  let rateLimitHeaders = ipRateLimitDecision.headers

  const context = await createContext({ context: c })
  const userId = context.session?.user.id

  if (userId) {
    const userRateLimitDecision = await evaluateRpcRateLimit(c.req.raw, {
      userId,
      skipIp: true,
    })

    if (!userRateLimitDecision.allowed) {
      return buildRpcRateLimitErrorResponse(userRateLimitDecision)
    }

    rateLimitHeaders = selectStrictestRateLimitHeaders(
      rateLimitHeaders,
      userRateLimitDecision.headers
    )
  }

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context,
  })

  if (rpcResult.matched) {
    const headers = new Headers(rpcResult.response.headers)
    for (const [key, value] of Object.entries(rateLimitHeaders)) {
      headers.set(key, value)
    }

    return new Response(rpcResult.response.body, {
      status: rpcResult.response.status,
      statusText: rpcResult.response.statusText,
      headers,
    })
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context,
  })

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response)
  }

  await next()
})

app.get("/", (c) => {
  return c.text("OK")
})

export default app
