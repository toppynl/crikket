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
import { useQuery } from "@tanstack/react-query"
import { BookOpen, ChevronRight, Settings, Video } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import type * as React from "react"
import { TeamSwitcher } from "@/components/team-switcher"
import { UserNav } from "@/components/user-nav"
import { SETTINGS_NAV, SETTINGS_ROOT } from "@/lib/settings-nav"
import { getDocsUrl } from "@/lib/site"
import { orpc } from "@/utils/orpc"

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
  const searchParams = useSearchParams()
  const docsUrl = getDocsUrl()
  const isSettingsActive =
    pathname === SETTINGS_ROOT || pathname.startsWith(`${SETTINGS_ROOT}/`)
  const activeProjectId = searchParams.get("projectId")
  const onBugReports = pathname === "/"
  const projectsQuery = useQuery(orpc.project.list.queryOptions())
  const projects = projectsQuery.data ?? []

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

                const isBugReports = item.matchPrefix === "/"

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
                    {isBugReports && projects.length > 0 ? (
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            isActive={onBugReports && !activeProjectId}
                            render={(props) => <Link href="/" {...props} />}
                          >
                            <span>Alle</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        {projects.map((project) => (
                          <SidebarMenuSubItem key={project.id}>
                            <SidebarMenuSubButton
                              isActive={
                                onBugReports && activeProjectId === project.id
                              }
                              render={(props) => (
                                <Link
                                  href={{
                                    pathname: "/",
                                    query: { projectId: project.id },
                                  }}
                                  {...props}
                                />
                              )}
                            >
                              <span>{project.name}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    ) : null}
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
