import {
  Building2,
  CreditCard,
  FolderOpen,
  Github,
  KeyRound,
  type LucideIcon,
  UserRound,
} from "lucide-react"
import type { Route } from "next"

export type SettingsNavItem = {
  href: Route
  title: string
  description: string
  icon: LucideIcon
}

/**
 * Single source of truth for the Settings sections.
 *
 * Consumed by the main sidebar (collapsible "Settings" group). Keeping the list
 * here prevents the sidebar and any in-page settings navigation from drifting.
 */
export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    href: "/settings/user" as Route,
    title: "User",
    description: "Profile and password",
    icon: UserRound,
  },
  {
    href: "/settings/organization" as Route,
    title: "Organization",
    description: "Workspace, members, invites",
    icon: Building2,
  },
  {
    href: "/settings/projects" as Route,
    title: "Projects",
    description: "Manage projects and integrations",
    icon: FolderOpen,
  },
  {
    href: "/settings/keys" as Route,
    title: "Public Keys",
    description: "Widget keys, origins, embeds",
    icon: KeyRound,
  },
  {
    href: "/settings/billing" as Route,
    title: "Billing",
    description: "Plan, pricing, payments",
    icon: CreditCard,
  },
  {
    href: "/settings/integrations/github" as Route,
    title: "GitHub",
    description: "Push bugs to GitHub Issues",
    icon: Github,
  },
]

export const SETTINGS_ROOT = "/settings"
