"use client"

import { paginationConfig } from "@crikket/shared/config/pagination"
import { DataTable } from "@crikket/ui/components/data-table/data-table"
import {
  getCoreRowModel,
  getPaginationRowModel,
  type PaginationState,
  type Updater,
  useReactTable,
} from "@tanstack/react-table"
import { parseAsInteger, useQueryStates } from "nuqs"
import * as React from "react"

import type { PublicKeyItem } from "../types"
import { createPublicKeysTableColumns } from "./public-keys-table-columns"

interface PublicKeysTableProps {
  assigningToProjectKeyId: string | null
  canManage: boolean
  deletingKeyId: string | null
  items: PublicKeyItem[]
  onAssignToProject: (keyId: string) => void
  onDelete: (input: { keyId: string }) => Promise<void>
  onEdit: (item: PublicKeyItem) => void
  onRevoke: (input: { keyId: string }) => Promise<void>
  onRotate: (input: { keyId: string }) => Promise<void>
  revokingKeyId: string | null
  rotatingKeyId: string | null
}

export function PublicKeysTable({
  assigningToProjectKeyId,
  canManage,
  deletingKeyId,
  items,
  onAssignToProject,
  onDelete,
  onEdit,
  onRevoke,
  onRotate,
  revokingKeyId,
  rotatingKeyId,
}: PublicKeysTableProps) {
  const [{ page, perPage }, setPaginationQuery] = useQueryStates(
    {
      page: parseAsInteger.withDefault(paginationConfig.defaultPage),
      perPage: parseAsInteger.withDefault(paginationConfig.defaultPageSize),
    },
    {
      history: "replace",
      shallow: false,
    }
  )

  const columns = React.useMemo(
    () =>
      createPublicKeysTableColumns({
        assigningToProjectKeyId,
        canManage,
        deletingKeyId,
        onAssignToProject,
        onDelete,
        onEdit,
        onRevoke,
        onRotate,
        revokingKeyId,
        rotatingKeyId,
      }),
    [
      assigningToProjectKeyId,
      canManage,
      deletingKeyId,
      onAssignToProject,
      onDelete,
      onEdit,
      onRevoke,
      onRotate,
      revokingKeyId,
      rotatingKeyId,
    ]
  )

  const pagination = React.useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: perPage,
    }),
    [page, perPage]
  )

  const table = useReactTable({
    columns,
    data: items,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: (updaterOrValue: Updater<PaginationState>) => {
      const nextPagination =
        typeof updaterOrValue === "function"
          ? updaterOrValue(pagination)
          : updaterOrValue

      setPaginationQuery({
        page: nextPagination.pageIndex + 1,
        perPage: nextPagination.pageSize,
      }).catch(() => undefined)
    },
    state: {
      pagination,
    },
  })

  return <DataTable hideSelectedRowsLabel table={table} />
}
