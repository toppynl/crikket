"use client"

import { cn } from "@crikket/ui/lib/utils"
import type { Route } from "next"
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
        const isActive =
          tab.href === base ? pathname === base : pathname.startsWith(tab.href)

        return (
          <Link
            className={cn(
              "-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            href={tab.href as Route}
            key={tab.href}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
