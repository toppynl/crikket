import { createSessionProcedures } from "@crikket/shared/lib/server/orpc-auth"

export type GitHubSessionContext = {
  user: { id: string }
  session: {
    activeOrganizationId?: string | null
  }
}

const { protectedProcedure } = createSessionProcedures<GitHubSessionContext>({
  isAuthorized: (session) => Boolean(session?.user?.id),
})

export { protectedProcedure }
