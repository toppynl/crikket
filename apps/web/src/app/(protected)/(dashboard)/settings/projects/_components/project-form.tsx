"use client"

import { Button } from "@crikket/ui/components/ui/button"
import { Field, FieldError, FieldLabel } from "@crikket/ui/components/ui/field"
import { Input } from "@crikket/ui/components/ui/input"
import { useForm } from "@tanstack/react-form"
import * as z from "zod"

const projectFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
  description: z.string(),
})

interface Props {
  isPending: boolean
  onSubmit: (values: {
    name: string
    slug: string
    description?: string
  }) => void
}

export function ProjectForm({ isPending, onSubmit }: Props) {
  const form = useForm({
    defaultValues: { name: "", slug: "", description: "" },
    validators: { onChange: projectFormSchema },
    onSubmit: ({ value }) => {
      onSubmit({
        name: value.name,
        slug: value.slug,
        description: value.description || undefined,
      })
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
                aria-invalid={isInvalid}
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="My App"
                value={field.state.value}
              />
              {isInvalid ? (
                <FieldError errors={field.state.meta.errors} />
              ) : null}
            </Field>
          )
        }}
      </form.Field>

      <form.Field name="slug">
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Slug</FieldLabel>
              <Input
                aria-invalid={isInvalid}
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="my-app"
                value={field.state.value}
              />
              <p className="text-muted-foreground text-xs">
                Unique within your org. Lowercase, numbers, hyphens only.
              </p>
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
            <Input
              id={field.name}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Optional description"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <Button disabled={isPending} type="submit">
        {isPending ? "Creating…" : "Create project"}
      </Button>
    </form>
  )
}
