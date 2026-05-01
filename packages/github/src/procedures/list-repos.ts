import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { getInstallationOctokit } from "../client"
import { getGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"

export const listRepos = protectedProcedure
  .input(z.object({ installationId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const organizationId = context.session.session.activeOrganizationId
    if (!organizationId) return []

    const orgIntegration = await getGitHubIntegration(organizationId)
    if (
      !orgIntegration ||
      orgIntegration.installationId !== input.installationId
    ) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Installation not associated with your organization",
      })
    }

    const octokit = await getInstallationOctokit(input.installationId)
    const { data } = await octokit.request("GET /installation/repositories", {
      per_page: 100,
    })
    return data.repositories.map((r) => ({
      owner: r.owner.login,
      name: r.name,
    }))
  })
