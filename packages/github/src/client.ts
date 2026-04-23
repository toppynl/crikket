import { env } from "@crikket/env/server"
import { App } from "@octokit/app"

let _app: App | null = null

function getApp(): App {
  if (_app) return _app
  if (!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY)) {
    throw new Error(
      "GitHub App not configured (missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY)"
    )
  }
  _app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString(
      "utf8"
    ),
  })
  return _app
}

export async function getInstallationOctokit(installationId: string) {
  return getApp().getInstallationOctokit(Number(installationId))
}

export async function getInstallationDetails(installationId: string) {
  const { data } = await getApp().octokit.request(
    "GET /app/installations/{installation_id}",
    { installation_id: Number(installationId) }
  )
  return data
}
