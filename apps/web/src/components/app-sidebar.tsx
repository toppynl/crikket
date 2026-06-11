"use client"

import type { authClient } from "@crikket/auth/client"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@crikket/ui/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@crikket/ui/components/ui/sidebar"
import { BookOpen, ChevronRight, Settings, Video } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type * as React from "react"
import { TeamSwitcher } from "@/components/team-switcher"
import { UserNav } from "@/components/user-nav"
import { SETTINGS_NAV, SETTINGS_ROOT } from "@/lib/settings-nav"
import { getDocsUrl } from "@/lib/site"

type Organization = typeof authClient.$Infer.Organization

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user: typeof authClient.$Infer.Session.user
  organizations: Organization[]
  activeOrganization?: Organization
}

const navPrimary = [
  {
    title: "Bug Reports",
    url: "/" as const,
    matchPrefix: "/" as const,
    icon: Video,
  },
]

const navSecondary = [
  {
    title: "Documentation",
    url: "/docs",
    icon: BookOpen,
  },
] as const

export function AppSidebar({
  user,
  organizations,
  activeOrganization,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname()
  const docsUrl = getDocsUrl()
  const isSettingsActive =
    pathname === SETTINGS_ROOT || pathname.startsWith(`${SETTINGS_ROOT}/`)

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <TeamSwitcher
          activeOrganization={activeOrganization}
          organizations={organizations}
          userId={user.id}
        />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navPrimary.map((item) => {
                const isActive =
                  item.matchPrefix === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.matchPrefix)

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      isActive={isActive}
                      render={(props) => (
                        <Link href={item.url as Route} {...props} />
                      )}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
              <Collapsible
                className="group/collapsible"
                defaultOpen={isSettingsActive}
                render={<SidebarMenuItem />}
              >
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton isActive={isSettingsActive}>
                      <Settings />
                      <span>Settings</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[panel-open]/menu-button:rotate-90" />
                    </SidebarMenuButton>
                  }
                />
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {SETTINGS_NAV.map((item) => {
                      const isActive =
                        pathname === item.href ||
                        pathname.startsWith(`${item.href}/`)

                      return (
                        <SidebarMenuSubItem key={item.href}>
                          <SidebarMenuSubButton
                            isActive={isActive}
                            render={(props) => (
                              <Link href={item.href} {...props} />
                            )}
                          >
                            <item.icon />
                            <span>{item.title}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {navSecondary.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={(props) =>
                      docsUrl ? (
                        <a
                          href={docsUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                          {...props}
                        />
                      ) : (
                        <button type="button" {...props} />
                      )
                    }
                    size="sm"
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserNav user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
