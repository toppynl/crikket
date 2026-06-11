"use client"

import type { AppRouterClient } from "@crikket/api/routers/index"
import type { TagColor } from "@crikket/shared/constants/tag"
import { useMutation, useQuery } from "@tanstack/react-query"

import { client, orpc, queryClient } from "@/utils/orpc"

export type OrgTag = Awaited<ReturnType<AppRouterClient["tag"]["list"]>>[number]

const tagListKey = orpc.tag.list.queryOptions().queryKey

export function useOrgTags() {
  const query = useQuery(orpc.tag.list.queryOptions())

  const createMutation = useMutation({
    mutationFn: (input: { name: string; color?: TagColor }) =>
      client.tag.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tagListKey })
    },
  })

  return {
    tags: query.data ?? [],
    isLoading: query.isLoading,
    createTag: (name: string, color?: TagColor) =>
      createMutation.mutateAsync({ name, color }),
    isCreating: createMutation.isPending,
  }
}
