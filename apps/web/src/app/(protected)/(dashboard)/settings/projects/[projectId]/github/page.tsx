import { client } from "@/utils/orpc"
import { ProjectGithubCard } from "./_components/project-github-card"

export default async function ProjectGithubPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const [orgConfig, projectConfig] = await Promise.all([
    client.github.getConfig().catch(() => null),
    client.github.getProjectConfig({ projectId }).catch(() => null),
  ])

  return (
    <ProjectGithubCard
      projectId={projectId}
      orgInstallationId={orgConfig?.installationId ?? null}
      currentConfig={
        projectConfig
          ? {
              owner: projectConfig.owner,
              repo: projectConfig.repo,
              autoSync: projectConfig.autoSync,
            }
          : null
      }
    />
  )
}
