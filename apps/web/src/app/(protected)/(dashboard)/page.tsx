import type { Metadata } from "next"

import { BugReportsList } from "./_components/bug-reports/bug-reports-list"

const META = {
  title: "Bug Reports",
  description: "View and manage your bug reports",
}

export const metadata: Metadata = {
  title: META.title,
  description: META.description,
}

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 pt-4">
      <BugReportsList />
    </div>
  )
}
