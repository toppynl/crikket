import { createPrivateKey } from "node:crypto"
import { env } from "@crikket/env/server"
import { App } from "@octokit/app"

let _app: App | null = null

function decodePrivateKey(rawKey: string): string {
  // Support both raw PEM and base64-encoded PEM
  let pem = rawKey.includes("-----BEGIN")
    ? rawKey
    : Buffer.from(rawKey, "base64").toString("utf8")
  // Normalize escaped newlines (common when set via env vars or wrangler secrets)
  pem = pem.replace(/\\n/g, "\n")
  // CF Workers WebCrypto only supports PKCS#8; convert PKCS#1 if needed
  if (pem.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    return createPrivateKey(pem).export({
      type: "pkcs8",
      format: "pem",
    }) as string
  }
  return pem
}

function getApp(): App {
  if (_app) return _app
  if (!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY)) {
    throw new Error(
      "GitHub App not configured (missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY)"
    )
  }
  _app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey: decodePrivateKey(env.GITHUB_APP_PRIVATE_KEY),
  })
  return _app
}

export function getInstallationOctokit(installationId: string) {
  return getApp().getInstallationOctokit(Number(installationId))
}

export async function getInstallationDetails(installationId: string) {
  const { data } = await getApp().octokit.request(
    "GET /app/installations/{installation_id}",
    { installation_id: Number(installationId) }
  )
  return data
}
