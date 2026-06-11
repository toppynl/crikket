"use client"

import type {
  BugReportSort,
  BugReportStatus,
  BugReportVisibility,
} from "@crikket/shared/constants/bug-report"
import type { Priority } from "@crikket/shared/constants/priorities"
import { Button } from "@crikket/ui/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crikket/ui/components/ui/dropdown-menu"
import {
  Faceted,
  FacetedBadgeList,
  FacetedContent,
  FacetedEmpty,
  FacetedGroup,
  FacetedInput,
  FacetedItem,
  FacetedList,
  FacetedTrigger,
} from "@crikket/ui/components/ui/faceted"
import { Input } from "@crikket/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crikket/ui/components/ui/select"
import { cn } from "@crikket/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import {
  Filter,
  Search,
  Shield,
  Tag,
  TriangleAlert,
  UserRound,
} from "lucide-react"
import type { ReactNode } from "react"

import { TagBadge } from "@/components/bug-reports/tag-badge"
import { tagDotClasses } from "@/components/bug-reports/tag-colors"
import { useOrgTags } from "@/components/bug-reports/use-org-tags"
import { orpc } from "@/utils/orpc"
import {
  type DashboardFilters,
  formatPriorityLabel,
  formatStatusLabel,
  formatVisibilityLabel,
  PRIORITY_FILTER_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  VISIBILITY_OPTIONS,
} from "./filters"
import type { BugReportStats } from "./types"

const ALL_PROJECTS_VALUE = "__all__"

interface BugReportsToolbarProps {
  search: string
  sort: BugReportSort
  filters: DashboardFilters
  stats?: BugReportStats
  onSearchChange: (value: string) => void
  onSortChange: (value: BugReportSort) => void
  onToggleStatus: (value: BugReportStatus) => void
  onTogglePriority: (value: Priority) => void
  onToggleVisibility: (value: BugReportVisibility) => void
  onProjectChange: (value: string | null) => void
  onTagsChange: (value: string[]) => void
  onClearFilters: () => void
}

function countActiveFilters(filters: DashboardFilters): number {
  return (
    filters.statuses.length +
    filters.priorities.length +
    filters.visibilities.length +
    (filters.projectId ? 1 : 0) +
    filters.tagIds.length
  )
}

export function BugReportsToolbar({
  search,
  sort,
  filters,
  stats,
  onSearchChange,
  onSortChange,
  onToggleStatus,
  onTogglePriority,
  onToggleVisibility,
  onProjectChange,
  onTagsChange,
  onClearFilters,
}: BugReportsToolbarProps) {
  const activeFilters = countActiveFilters(filters)
  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Sort"

  const projectsQuery = useQuery(orpc.project.list.queryOptions())
  const projects = projectsQuery.data ?? []
  const { tags } = useOrgTags()

  const tagOptions = tags.map((tag) => ({ label: tag.name, value: tag.id }))
  const selectedProject = filters.projectId
    ? projects.find((project) => project.id === filters.projectId)
    : undefined
  const selectedTags = filters.tagIds
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is (typeof tags)[number] => Boolean(tag))

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search title, description, or URL"
            value={search}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            onValueChange={(value) => onSortChange(value as BugReportSort)}
            value={sort}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue>{selectedSortLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            onValueChange={(value) =>
              onProjectChange(value === ALL_PROJECTS_VALUE ? null : value)
            }
            value={filters.projectId ?? ALL_PROJECTS_VALUE}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue>
                {selectedProject?.name ?? "All projects"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS_VALUE}>All projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Faceted
            multiple
            onValueChange={(value) => onTagsChange(value ?? [])}
            value={filters.tagIds}
          >
            <FacetedTrigger
              render={
                <Button className="w-[160px]" size="sm" variant="outline" />
              }
            >
              <FacetedBadgeList
                max={1}
                options={tagOptions}
                placeholder="Tags"
              />
            </FacetedTrigger>
            <FacetedContent>
              <FacetedInput placeholder="Search tags..." />
              <FacetedList>
                <FacetedEmpty>No tags found.</FacetedEmpty>
                <FacetedGroup>
                  {tags.map((tag) => (
                    <FacetedItem key={tag.id} value={tag.id}>
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          tagDotClasses(tag.color)
                        )}
                      />
                      <span className="truncate">{tag.name}</span>
                    </FacetedItem>
                  ))}
                </FacetedGroup>
              </FacetedList>
            </FacetedContent>
          </Faceted>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" variant="outline">
                  <Filter className="size-4" />
                  Filters
                  {activeFilters > 0 ? ` (${activeFilters})` : ""}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                {STATUS_OPTIONS.map((status) => (
                  <DropdownMenuCheckboxItem
                    checked={filters.statuses.includes(status.value)}
                    key={status.value}
                    onCheckedChange={() => onToggleStatus(status.value)}
                  >
                    {status.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Priority</DropdownMenuLabel>
                {PRIORITY_FILTER_OPTIONS.map((priority) => (
                  <DropdownMenuCheckboxItem
                    checked={filters.priorities.includes(priority.value)}
                    key={priority.value}
                    onCheckedChange={() => onTogglePriority(priority.value)}
                  >
                    {priority.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Visibility</DropdownMenuLabel>
                {VISIBILITY_OPTIONS.map((visibility) => (
                  <DropdownMenuCheckboxItem
                    checked={filters.visibilities.includes(visibility.value)}
                    key={visibility.value}
                    onCheckedChange={() => onToggleVisibility(visibility.value)}
                  >
                    {visibility.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            disabled={activeFilters === 0}
            onClick={onClearFilters}
            size="sm"
            variant="ghost"
          >
            Clear filters
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatChip
          icon={<TriangleAlert className="size-3.5" />}
          label="Open"
          value={stats?.open ?? 0}
        />
        <StatChip
          icon={<Shield className="size-3.5" />}
          label="Untriaged"
          value={stats?.untriaged ?? 0}
        />
        <StatChip
          icon={<UserRound className="size-3.5" />}
          label="Mine"
          value={stats?.mine ?? 0}
        />
        <StatChip
          icon={<Tag className="size-3.5" />}
          label="Total"
          value={stats?.total ?? 0}
        />
        {selectedProject ? <Pill>{selectedProject.name}</Pill> : null}
        {selectedTags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} withDot />
        ))}
        {filters.statuses.map((status) => (
          <Pill key={status}>{formatStatusLabel(status)}</Pill>
        ))}
        {filters.priorities.map((priority) => (
          <Pill key={priority}>{formatPriorityLabel(priority)}</Pill>
        ))}
        {filters.visibilities.map((visibility) => (
          <Pill key={visibility}>{formatVisibilityLabel(visibility)}</Pill>
        ))}
      </div>
    </div>
  )
}

function StatChip({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: number
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 font-medium text-xs">
      {icon}
      {label}: {value}
    </span>
  )
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border bg-muted px-2 py-1 text-xs">
      {children}
    </span>
  )
}
