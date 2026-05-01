# Project Settings UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve settings navigation (single Settings link in main sidebar, add Projects to settings sidebar), add per-project settings pages with General + GitHub tabs, and replace GitHub repo text inputs with a dynamic searchable combobox.

**Architecture:** New `github.listRepos` ORPC procedure fetches repos from the GitHub App installation. A shared `RepoCombobox` client component uses it in both org-level and project-level GitHub config forms. Per-project settings get a layout with tab nav; a new General page handles name/description editing. Main sidebar is simplified to a single Settings entry point.

**Tech Stack:** Next.js 16 App Router, ORPC, @octokit/app, Shadcn UI (Command + Popover for combobox), TanStack Form, Drizzle ORM, Bun/Turborepo monorepo.

---

### Task 1: Add `listRepos` GitHub procedure

**Files:**
- Create: `packages/github/src/procedures/list-repos.ts`
- Modify: `packages/api/src/routers/github.ts`

**Step 1: Create the procedure**

```ts
// packages/github/src/procedures/list-repos.ts
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
```

**Step 2: Register in the router**

In `packages/api/src/routers/github.ts`, add the import and export:

```ts
import { listRepos } from "@crikket/github/procedures/list-repos"
// add to githubRouter:
listRepos,
```

**Step 3: Type-check**

```bash
bun run check-types
```
Expected: no errors.

**Step 4: Commit**

```bash
git add packages/github/src/procedures/list-repos.ts packages/api/src/routers/github.ts
git commit -m "feat(github): add listRepos procedure"
```

---

### Task 2: Add `getProject` procedure

The per-project layout needs to fetch a project by ID to display the project name.

**Files:**
- Modify: `packages/bug-reports/src/procedures/projects.ts`
- Modify: `packages/api/src/routers/project.ts`

**Step 1: Add the procedure to `projects.ts`**

After the existing `listProjectsProcedure`, add:

```ts
export const getProjectProcedure = protectedProcedure
  .input(projectIdSchema)
  .handler(async ({ context, input }) => {
    const organizationId = requireActiveOrgId(context.session)
    return await getProjectById({ id: input.id, organizationId })
  })
```

**Step 2: Register in the router**

In `packages/api/src/routers/project.ts`:

```ts
import {
  createProjectProcedure,
  deleteProjectProcedure,
  getProjectProcedure,
  listProjectsProcedure,
  updateProjectProcedure,
} from "@crikket/bug-reports/procedures/projects"

export const projectRouter = {
  list: listProjectsProcedure,
  get: getProjectProcedure,
  create: createProjectProcedure,
  update: updateProjectProcedure,
  delete: deleteProjectProcedure,
}
```

**Step 3: Type-check**

```bash
bun run check-types
```

**Step 4: Commit**

```bash
git add packages/bug-reports/src/procedures/projects.ts packages/api/src/routers/project.ts
git commit -m "feat(projects): add getProject procedure"
```

---

### Task 3: Build `RepoCombobox` component

Uses Shadcn Command + Popover (the standard Shadcn combobox pattern). Fetches repos from `client.github.listRepos` on mount when `installationId` is provided.

**Files:**
- Create: `apps/web/src/components/github-repo-combobox.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/github-repo-combobox.tsx
"use client"

import { Button } from "@crikket/ui/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@crikket/ui/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@crikket/ui/components/ui/popover"
import { cn } from "@crikket/ui/lib/utils"
import { Check, ChevronsUpDown } from "lucide-react"
import * as React from "react"
import { client } from "@/utils/orpc"

interface Props {
  installationId: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function RepoCombobox({ installationId, value, onChange, disabled }: Props) {
  const [open, setOpen] = React.useState(false)
  const [repos, setRepos] = React.useState<{ owner: string; name: string }[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!installationId) return
    setLoading(true)
    client.github.listRepos({ installationId })
      .then(setRepos)
      .catch(() => setRepos([]))
      .finally(() => setLoading(false))
  }, [installationId])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="w-full justify-between font-normal"
        >
          {value || (loading ? "Loading repositories…" : "Select repository…")}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search repositories…" />
          <CommandList>
            <CommandEmpty>No repositories found.</CommandEmpty>
            <CommandGroup>
              {repos.map((repo) => (
                <CommandItem
                  key={repo.name}
                  value={repo.name}
                  onSelect={(selected) => {
                    onChange(selected)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === repo.name ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="text-muted-foreground mr-1">{repo.owner}/</span>
                  {repo.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
```

**Step 2: Type-check**

```bash
bun run check-types
```

**Step 3: Commit**

```bash
git add apps/web/src/components/github-repo-combobox.tsx
git commit -m "feat(ui): add RepoCombobox component"
```

---

### Task 4: Replace repo text input on org-level GitHub config

**Files:**
- Modify: `apps/web/src/app/(protected)/(dashboard)/settings/integrations/github/_components/github-integration-card.tsx`

**Step 1: Replace the `defaultRepo` field**

Replace the `form.Field name="defaultRepo"` block (the entire `<Field>…</Field>` wrapper, lines ~145–175) with:

```tsx
<form.Field name="defaultRepo">
  {(field) => {
    const isInvalid =
      field.state.meta.isTouched &&
      field.state.meta.errors.length > 0
    return (
      <Field data-invalid={isInvalid}>
        <FieldLabel htmlFor={field.name}>Default repository</FieldLabel>
        <RepoCombobox
          installationId={form.getFieldValue("installationId")}
          value={field.state.value}
          onChange={field.handleChange}
        />
        {isInvalid ? (
          <FieldError errors={field.state.meta.errors} />
        ) : null}
      </Field>
    )
  }}
</form.Field>
```

Add the import at the top of the file:

```ts
import { RepoCombobox } from "@/components/github-repo-combobox"
```

Remove the now-unused `Input` import if nothing else uses it.

**Step 2: Type-check and lint**

```bash
bun run check-types && bun run check
```

**Step 3: Commit**

```bash
git add "apps/web/src/app/(protected)/(dashboard)/settings/integrations/github/_components/github-integration-card.tsx"
git commit -m "feat(github): replace org-level repo text input with combobox"
```

---

### Task 5: Replace repo text input on project-level GitHub config

**Files:**
- Modify: `apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/github/_components/project-github-card.tsx`

**Step 1: Replace the `repo` field**

Replace the `form.Field name="repo"` block (the entire `<Field>…</Field>` wrapper) with:

```tsx
<form.Field name="repo">
  {(field) => {
    const isInvalid =
      field.state.meta.isTouched &&
      field.state.meta.errors.length > 0
    return (
      <Field data-invalid={isInvalid}>
        <FieldLabel htmlFor={field.name}>Repository</FieldLabel>
        <RepoCombobox
          installationId={orgInstallationId}
          value={field.state.value}
          onChange={field.handleChange}
        />
        {isInvalid ? (
          <FieldError errors={field.state.meta.errors} />
        ) : null}
      </Field>
    )
  }}
</form.Field>
```

Add the import:

```ts
import { RepoCombobox } from "@/components/github-repo-combobox"
```

Remove unused `Input` import if applicable.

**Step 2: Type-check and lint**

```bash
bun run check-types && bun run check
```

**Step 3: Commit**

```bash
git add "apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/github/_components/project-github-card.tsx"
git commit -m "feat(github): replace project-level repo text input with combobox"
```

---

### Task 6: Simplify main app sidebar to single Settings link

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx`

**Step 1: Replace `navSettings` with a single entry and update the group**

Replace the `navSettings` array:

```ts
import {
  BookOpen,
  Settings,
  Video,
} from "lucide-react"
```

Remove `Building2`, `CreditCard`, `KeyRound`, `UserRound` from the import (unless used elsewhere in the file).

Replace `navSettings`:

```ts
const navSettings = [
  {
    title: "Settings",
    url: "/settings" as const,
    icon: Settings,
  },
] as const
```

The `isActive` logic in the settings group already uses `pathname.startsWith(item.url)`, which correctly highlights Settings for any `/settings/*` path.

**Step 2: Type-check**

```bash
bun run check-types
```

**Step 3: Commit**

```bash
git add apps/web/src/components/app-sidebar.tsx
git commit -m "feat(nav): simplify main sidebar to single Settings link"
```

---

### Task 7: Add Projects to settings sidebar nav

**Files:**
- Modify: `apps/web/src/app/(protected)/(dashboard)/settings/_components/settings-navigation.tsx`

**Step 1: Add the Projects item**

Add `FolderOpen` to the lucide-react import.

Add a new item to `SETTINGS_ITEMS` before the GitHub item:

```ts
{
  href: "/settings/projects",
  title: "Projects",
  description: "Manage projects and integrations",
  icon: FolderOpen,
},
```

**Step 2: Type-check**

```bash
bun run check-types
```

**Step 3: Commit**

```bash
git add "apps/web/src/app/(protected)/(dashboard)/settings/_components/settings-navigation.tsx"
git commit -m "feat(nav): add Projects to settings sidebar"
```

---

### Task 8: Make project list rows navigate to per-project settings

**Files:**
- Modify: `apps/web/src/app/(protected)/(dashboard)/settings/projects/_components/projects-management.tsx`

**Step 1: Update the project row**

Replace the `<li>` content for each project row. Import `Link` from `next/link` and `ChevronRight` from lucide-react.

```tsx
import Link from "next/link"
import { ChevronRight, Plus } from "lucide-react"
```

Replace the `<li>` body:

```tsx
<li key={p.id} className="flex items-center justify-between py-3">
  <Link
    href={`/settings/projects/${p.id}`}
    className="group flex flex-1 items-center justify-between rounded-lg pr-2 hover:text-foreground"
  >
    <div>
      <p className="font-medium text-sm">{p.name}</p>
      <p className="text-muted-foreground text-xs">{p.slug}</p>
    </div>
    <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" />
  </Link>
  {canManage && (
    <Button
      onClick={() => handleDelete(p.id)}
      size="sm"
      type="button"
      variant="ghost"
      className="ml-2 shrink-0"
    >
      Delete
    </Button>
  )}
</li>
```

**Step 2: Type-check and lint**

```bash
bun run check-types && bun run check
```

**Step 3: Commit**

```bash
git add "apps/web/src/app/(protected)/(dashboard)/settings/projects/_components/projects-management.tsx"
git commit -m "feat(projects): make project rows link to per-project settings"
```

---

### Task 9: Per-project settings layout with tab nav

**Files:**
- Create: `apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/layout.tsx`

**Step 1: Create the layout**

```tsx
// apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/layout.tsx
import { client } from "@/utils/orpc"
import { notFound } from "next/navigation"
import Link from "next/link"
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
```

**Step 2: Create the tab nav component**

Create: `apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/_components/project-settings-tabs.tsx`

```tsx
"use client"

import { cn } from "@crikket/ui/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"

interface Props {
  projectId: string
}

export function ProjectSettingsTabs({ projectId }: Props) {
  const pathname = usePathname()
  const base = `/settings/projects/${projectId}`

  const tabs = [
    { href: base, label: "General" },
    { href: `${base}/github`, label: "GitHub Issues" },
  ]

  return (
    <div className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const isActive = tab.href === base
          ? pathname === base
          : pathname.startsWith(tab.href)

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
```

**Step 3: Type-check**

```bash
bun run check-types
```

**Step 4: Commit**

```bash
git add "apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/layout.tsx" \
        "apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/_components/project-settings-tabs.tsx"
git commit -m "feat(projects): add per-project settings layout with tab nav"
```

---

### Task 10: General project settings page

**Files:**
- Create: `apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/page.tsx`
- Create: `apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/_components/project-general-form.tsx`

**Step 1: Create the form component**

```tsx
// .../_components/project-general-form.tsx
"use client"

import { Button } from "@crikket/ui/components/ui/button"
import { Field, FieldError, FieldLabel } from "@crikket/ui/components/ui/field"
import { Input } from "@crikket/ui/components/ui/input"
import { Textarea } from "@crikket/ui/components/ui/textarea"
import { useForm } from "@tanstack/react-form"
import { useRouter } from "nextjs-toploader/app"
import { toast } from "sonner"
import * as z from "zod"
import { client } from "@/utils/orpc"
import type { ProjectRecord } from "@crikket/bug-reports/lib/project"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
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
          const isInvalid = field.state.meta.isTouched && field.state.meta.errors.length > 0
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
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
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </Field>
        )}
      </form.Field>

      <div>
        <p className="text-muted-foreground text-xs mb-4">
          Slug: <code>{project.slug}</code>
        </p>
        <Button disabled={form.state.isSubmitting} type="submit">
          {form.state.isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}
```

**Step 2: Create the page**

```tsx
// .../[projectId]/page.tsx
import { client } from "@/utils/orpc"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import { notFound } from "next/navigation"
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
        <CardDescription>Update the project name and description.</CardDescription>
      </CardHeader>
      <CardContent>
        <ProjectGeneralForm project={project} />
      </CardContent>
    </Card>
  )
}
```

**Step 3: Type-check and lint**

```bash
bun run check-types && bun run check
```

**Step 4: Commit**

```bash
git add "apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/page.tsx" \
        "apps/web/src/app/(protected)/(dashboard)/settings/projects/[projectId]/_components/project-general-form.tsx"
git commit -m "feat(projects): add general project settings page"
```

---

### Task 11: Final smoke-check

1. Run `bun run check-types` — expect zero errors.
2. Run `bun run check` — expect zero lint errors.
3. Start dev server: `bun run dev`
4. Verify main sidebar shows a single "Settings" link, active on any `/settings/*` path.
5. Navigate to Settings — confirm Projects appears in settings sidebar.
6. Navigate to Settings → Projects — confirm each project row is a link with a chevron.
7. Click a project — confirm the layout shows the project name, and General / GitHub Issues tabs.
8. On General tab — edit name, save, confirm toast and refresh.
9. On GitHub Issues tab — confirm repo combobox loads repos from GitHub installation.
10. Navigate to Settings → GitHub — confirm org-level repo combobox loads repos.
