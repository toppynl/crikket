import { z } from "zod"
import { getInstallationOctokit } from "../client"
import { protectedProcedure } from "./context"

export const listRepos = protectedProcedure
  .input(z.object({ installationId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const octokit = await getInstallationOctokit(input.installationId)
    const { data } = await octokit.request("GET /installation/repositories", {
      per_page: 100,
    })
    return data.repositories.map((r) => ({
      owner: r.owner.login,
      name: r.name,
    }))
  })
