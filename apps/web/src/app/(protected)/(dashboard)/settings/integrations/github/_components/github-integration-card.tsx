"use client"

import { Button, buttonVariants } from "@crikket/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import { Input } from "@crikket/ui/components/ui/input"
import { useForm } from "@tanstack/react-form"
import { Github } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { client } from "@/utils/orpc"

type Props = {
  githubAppSlug: string | undefined
  currentConfig: {
    installationId: string
    defaultOwner: string
    defaultRepo: string
  } | null
  organizationId: string
}

export function GitHubIntegrationCard({
  githubAppSlug,
  currentConfig,
  organizationId: _organizationId,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingInstallationId = searchParams.get("installation_id")

  const form = useForm({
    defaultValues: {
      installationId:
        pendingInstallationId ?? currentConfig?.installationId ?? "",
      defaultRepo: currentConfig?.defaultRepo ?? "",
    },
    onSubmit: async ({ value }) => {
      try {
        await client.github.configure({
          installationId: value.installationId,
          defaultRepo: value.defaultRepo,
        })
        toast.success("GitHub integration saved")
        router.replace("/settings/integrations/github")
        router.refresh()
      } catch {
        toast.error("Failed to save GitHub integration")
      }
    },
  })

  async function handleDisconnect() {
    try {
      await client.github.deleteConfig()
      toast.success("GitHub integration disconnected")
      router.refresh()
    } catch {
      toast.error("Failed to disconnect")
    }
  }

  const installUrl = githubAppSlug
    ? `https://github.com/apps/${githubAppSlug}/installations/new`
    : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Github className="size-5" />
          <CardTitle>GitHub Issues</CardTitle>
        </div>
        <CardDescription>
          Push bug reports to GitHub Issues and sync their status back
          automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!(currentConfig || pendingInstallationId) && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Connect your GitHub account to push bug reports as GitHub Issues.
            </p>
            {installUrl ? (
              <a
                className={buttonVariants()}
                href={installUrl}
                rel="noreferrer"
                target="_blank"
              >
                Install GitHub App
              </a>
            ) : (
              <p className="text-muted-foreground text-xs">
                NEXT_PUBLIC_GITHUB_APP_SLUG is not configured.
              </p>
            )}
          </div>
        )}

        {(currentConfig || pendingInstallationId) && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              form.handleSubmit()
            }}
          >
            {currentConfig && (
              <p className="text-sm">
                Connected to <strong>{currentConfig.defaultOwner}</strong>
              </p>
            )}

            <form.Field name="installationId">
              {(field) => <input type="hidden" value={field.state.value} />}
            </form.Field>

            <form.Field name="defaultRepo">
              {(field) => (
                <div className="space-y-1">
                  <label className="font-medium text-sm" htmlFor="defaultRepo">
                    Default repository
                  </label>
                  <Input
                    id="defaultRepo"
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="my-repo"
                    value={field.state.value}
                  />
                  <p className="text-muted-foreground text-xs">
                    Repository name only (e.g. <code>my-repo</code>). The owner
                    is resolved from your GitHub App installation.
                  </p>
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
        )}
      </CardContent>
    </Card>
  )
}
