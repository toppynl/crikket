import { authClient } from "@crikket/auth/client"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getProtectedAuthData } from "@/app/(protected)/_lib/get-protected-auth-data"
import { client } from "@/utils/orpc"
import { ProjectsManagement } from "./_components/projects-management"

export const metadata: Metadata = {
  title: "Projects",
  description: "Manage projects to group capture keys and bug reports.",
}

export default async function ProjectsPage() {
  const { organizations, session } = await getProtectedAuthData()

  if (!session) {
    redirect("/login")
  }

  if (organizations.length === 0) {
    redirect("/onboarding")
  }

  const activeOrganization =
    organizations.find(
      (organization) => organization.id === session.session.activeOrganizationId
    ) ?? organizations[0]

  const requestHeaders = await headers()
  const authFetchOptions = {
    fetchOptions: {
      headers: requestHeaders,
    },
  }

  const { data: memberRoleData } =
    await authClient.organization.getActiveMemberRole({
      query: {
        organizationId: activeOrganization.id,
      },
      ...authFetchOptions,
    })

  const canManage =
    memberRoleData?.role === "owner" || memberRoleData?.role === "admin"

  const projects = await client.project.list().catch(() => [])

  return (
    <ProjectsManagement canManage={canManage} initialProjects={projects} />
  )
}
