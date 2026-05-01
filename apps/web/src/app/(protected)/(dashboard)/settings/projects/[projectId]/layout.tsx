import { notFound } from "next/navigation"
import { client } from "@/utils/orpc"
import { ProjectSettingsTabs } from "./_components/project-settings-tabs"

export default async function ProjectSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const project = await client.project.get({ id: projectId }).catch(() => null)
  if (!project) notFound()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-semibold text-xl">{project.name}</h2>
        <p className="text-muted-foreground text-sm">Project settings</p>
      </div>
      <ProjectSettingsTabs projectId={projectId} />
      {children}
    </div>
  )
}
