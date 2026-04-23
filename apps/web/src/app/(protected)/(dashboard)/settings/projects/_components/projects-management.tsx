"use client"

import { Button } from "@crikket/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@crikket/ui/components/ui/dialog"
import { Plus } from "lucide-react"
import * as React from "react"
import { client } from "@/utils/orpc"
import { useRouter } from "nextjs-toploader/app"
import { toast } from "sonner"
import { ProjectForm } from "./project-form"
import type { ProjectRecord } from "@crikket/bug-reports/lib/project"

interface Props {
  canManage: boolean
  initialProjects: ProjectRecord[]
}

export function ProjectsManagement({ canManage, initialProjects }: Props) {
  const router = useRouter()
  const [projects, setProjects] = React.useState(initialProjects)
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  async function handleCreate(values: {
    name: string
    slug: string
    description?: string
  }) {
    setIsSubmitting(true)
    try {
      const created = await client.project.create(values)
      setProjects((prev) => [created, ...prev])
      setIsCreateOpen(false)
      toast.success("Project created")
      router.refresh()
    } catch {
      toast.error("Failed to create project")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    // biome-ignore lint/suspicious/noAlert: intentional simple confirmation for destructive action
    if (!confirm("Delete this project? This cannot be undone.")) return
    try {
      await client.project.delete({ id })
      setProjects((prev) => prev.filter((p) => p.id !== id))
      toast.success("Project deleted")
      router.refresh()
    } catch {
      toast.error("Failed to delete project")
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Projects</CardTitle>
            <CardDescription>
              Group capture keys and bug reports by project (app, site, or
              service). Each project can have its own GitHub Issues target.
            </CardDescription>
          </div>
          <Button
            disabled={!canManage}
            onClick={() => setIsCreateOpen(true)}
            type="button"
          >
            <Plus />
            New project
          </Button>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No projects yet. Create one to start grouping your capture keys.
            </p>
          ) : (
            <ul className="divide-y">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-muted-foreground text-xs">{p.slug}</p>
                  </div>
                  {canManage && (
                    <Button
                      onClick={() => handleDelete(p.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Delete
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog onOpenChange={setIsCreateOpen} open={isCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
          </DialogHeader>
          <ProjectForm isPending={isSubmitting} onSubmit={handleCreate} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
