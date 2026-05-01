"use client"

import type { ProjectRecord } from "@crikket/bug-reports/lib/project"
import { Button } from "@crikket/ui/components/ui/button"
import { Field, FieldError, FieldLabel } from "@crikket/ui/components/ui/field"
import { Input } from "@crikket/ui/components/ui/input"
import { Textarea } from "@crikket/ui/components/ui/textarea"
import { useForm } from "@tanstack/react-form"
import { useRouter } from "nextjs-toploader/app"
import { toast } from "sonner"
import * as z from "zod"
import { client } from "@/utils/orpc"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(500),
})

export function ProjectGeneralForm({ project }: { project: ProjectRecord }) {
  const router = useRouter()

  const form = useForm({
    defaultValues: {
      name: project.name,
      description: project.description ?? "",
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      try {
        await client.project.update({
          id: project.id,
          name: value.name,
          description: value.description || null,
        })
        toast.success("Project updated")
        router.refresh()
      } catch {
        toast.error("Failed to update project")
      }
    },
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <form.Field name="name">
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                value={field.state.value}
              />
              {isInvalid ? (
                <FieldError errors={field.state.meta.errors} />
              ) : null}
            </Field>
          )
        }}
      </form.Field>

      <form.Field name="description">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Description</FieldLabel>
            <Textarea
              id={field.name}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Optional description"
              rows={3}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <div>
        <p className="mb-4 text-muted-foreground text-xs">
          Slug: <code>{project.slug}</code>
        </p>
        <Button disabled={form.state.isSubmitting} type="submit">
          {form.state.isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}
