import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import { notFound } from "next/navigation"
import { client } from "@/utils/orpc"
import { ProjectGeneralForm } from "./_components/project-general-form"

export default async function ProjectGeneralPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const project = await client.project.get({ id: projectId }).catch(() => null)
  if (!project) notFound()

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>
          Update the project name and description.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProjectGeneralForm project={project} />
      </CardContent>
    </Card>
  )
}
