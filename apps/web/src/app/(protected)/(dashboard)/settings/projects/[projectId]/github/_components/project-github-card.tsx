"use client"

import { Button } from "@crikket/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import { Checkbox } from "@crikket/ui/components/ui/checkbox"
import { Field, FieldError, FieldLabel } from "@crikket/ui/components/ui/field"
import { Input } from "@crikket/ui/components/ui/input"
import { useForm } from "@tanstack/react-form"
import { Github } from "lucide-react"
import { useRouter } from "nextjs-toploader/app"
import { toast } from "sonner"
import * as z from "zod"
import { client } from "@/utils/orpc"

const schema = z.object({
  repo: z.string().min(1, "Repository name is required"),
  autoSync: z.boolean(),
})

type Props = {
  projectId: string
  orgInstallationId: string | null
  currentConfig: {
    owner: string
    repo: string
    autoSync: boolean
  } | null
}

export function ProjectGithubCard({
  projectId,
  orgInstallationId,
  currentConfig,
}: Props) {
  const router = useRouter()

  const form = useForm({
    defaultValues: {
      repo: currentConfig?.repo ?? "",
      autoSync: currentConfig?.autoSync ?? false,
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      if (!orgInstallationId) return
      try {
        await client.github.configureProject({
          projectId,
          installationId: orgInstallationId,
          repo: value.repo,
          autoSync: value.autoSync,
        })
        toast.success("GitHub config saved")
        router.refresh()
      } catch {
        toast.error("Failed to save GitHub config")
      }
    },
  })

  async function handleDisconnect() {
    if (
      // biome-ignore lint/suspicious/noAlert: intentional simple confirmation for destructive action
      !confirm("Remove GitHub config for this project? This cannot be undone.")
    )
      return
    try {
      await client.github.deleteProjectConfig({ projectId })
      toast.success("GitHub config removed")
      router.refresh()
    } catch {
      toast.error("Failed to remove GitHub config")
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Github className="size-5" />
          <CardTitle>GitHub Issues</CardTitle>
        </div>
        <CardDescription>
          Push bug reports from this project to a GitHub repository.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {orgInstallationId ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              form.handleSubmit()
            }}
          >
            {currentConfig && (
              <p className="text-sm">
                Connected to <strong>{currentConfig.owner}</strong>
              </p>
            )}

            <form.Field name="repo">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched &&
                  field.state.meta.errors.length > 0
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Repository</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="my-repo"
                      value={field.state.value}
                    />
                    <p className="text-muted-foreground text-xs">
                      Repository name only (e.g. <code>my-repo</code>). The
                      owner is resolved from your GitHub App installation.
                    </p>
                    {isInvalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>

            <form.Field name="autoSync">
              {(field) => (
                <div className="flex items-start gap-3 rounded-lg border p-4">
                  <Checkbox
                    checked={field.state.value}
                    id={field.name}
                    onCheckedChange={(checked) =>
                      field.handleChange(checked === true)
                    }
                  />
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor={field.name}>
                      Auto-sync new reports
                    </FieldLabel>
                    <p className="text-muted-foreground text-sm">
                      Automatically forward every new bug report from this
                      project to GitHub Issues.
                    </p>
                  </div>
                </div>
              )}
            </form.Field>

            <div className="flex gap-2">
              <Button disabled={form.state.isSubmitting} type="submit">
                {form.state.isSubmitting ? "Saving…" : "Save"}
              </Button>
              {currentConfig && (
                <Button
                  onClick={handleDisconnect}
                  type="button"
                  variant="destructive"
                >
                  Disconnect
                </Button>
              )}
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">
            No GitHub App installed at the org level. Configure the org
            integration first at{" "}
            <a className="underline" href="/settings/integrations/github">
              Settings → Integrations → GitHub
            </a>
            .
          </p>
        )}
      </CardContent>
    </Card>
  )
}
