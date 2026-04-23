import { env } from "@crikket/env/web"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { getProtectedAuthData } from "@/app/(protected)/_lib/get-protected-auth-data"
import { client } from "@/utils/orpc"
import { GitHubIntegrationCard } from "./_components/github-integration-card"

export const metadata: Metadata = {
  title: "GitHub Integration",
  description: "Connect Crikket to GitHub Issues.",
}

export default async function GitHubIntegrationPage() {
  const { organizations, session } = await getProtectedAuthData()

  if (!session) redirect("/login")
  if (organizations.length === 0) redirect("/onboarding")

  const activeOrganization =
    organizations.find((o) => o.id === session.session.activeOrganizationId) ??
    organizations[0]

  const currentConfig = await client.github.getConfig().catch(() => null)

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-xl">GitHub Integration</h2>
      <Suspense>
        <GitHubIntegrationCard
          currentConfig={currentConfig}
          githubAppSlug={env.NEXT_PUBLIC_GITHUB_APP_SLUG}
          organizationId={activeOrganization.id}
        />
      </Suspense>
    </div>
  )
}
