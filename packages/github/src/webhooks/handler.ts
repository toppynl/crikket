import { createHmac, timingSafeEqual } from "node:crypto"
import { db } from "@crikket/db"
import { githubWebhookEvent } from "@crikket/db/schema/github"
import { env } from "@crikket/env/server"
import { nanoid } from "nanoid"

function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = createHmac("sha256", secret)
  hmac.update(payload)
  const expected = Buffer.from(`sha256=${hmac.digest("hex")}`)
  const actual = Buffer.from(signature)
  try {
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export async function handleGitHubWebhook(request: Request): Promise<Response> {
  const secret = env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    return new Response("GitHub webhook not configured", { status: 503 })
  }

  const signature = request.headers.get("x-hub-signature-256") ?? ""
  const deliveryId = request.headers.get("x-github-delivery") ?? ""
  const eventType = request.headers.get("x-github-event") ?? "unknown"

  const payload = await request.text()

  if (!verifySignature(payload, signature, secret)) {
    return new Response("Invalid signature", { status: 401 })
  }

  if (!deliveryId) {
    return new Response("Missing x-github-delivery header", { status: 400 })
  }

  let parsedPayload: unknown
  try {
    parsedPayload = JSON.parse(payload)
  } catch {
    return new Response("Invalid JSON payload", { status: 400 })
  }

  try {
    await db.insert(githubWebhookEvent).values({
      id: nanoid(),
      githubDeliveryId: deliveryId,
      eventType,
      status: "received",
      payload: parsedPayload,
    })
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code
    const message = (error as { message?: string })?.message ?? ""
    if (code === "23505" || message.includes("unique")) {
      return new Response("OK", { status: 200 })
    }
    throw error
  }

  return new Response("OK", { status: 200 })
}
