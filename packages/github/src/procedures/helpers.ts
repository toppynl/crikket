import { db } from "@crikket/db"
import { member } from "@crikket/db/schema/auth"
import { ORPCError } from "@orpc/server"
import { and, eq } from "drizzle-orm"

export function requireActiveOrgId(session: {
  session: { activeOrganizationId?: string | null }
}): string {
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    throw new ORPCError("UNAUTHORIZED", { message: "No active organization" })
  }
  return activeOrgId
}

export async function requireActiveOrgAdmin(session: {
  user: { id: string }
  session: { activeOrganizationId?: string | null }
}): Promise<string> {
  const activeOrgId = requireActiveOrgId(session)

  const activeMember = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, activeOrgId),
      eq(member.userId, session.user.id)
    ),
    columns: { role: true },
  })

  if (!(activeMember && isOrgAdminRole(activeMember.role))) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Only organization admins or owners can manage the GitHub integration.",
    })
  }

  return activeOrgId
}

function isOrgAdminRole(role: string): boolean {
  return role === "owner" || role === "admin"
}
