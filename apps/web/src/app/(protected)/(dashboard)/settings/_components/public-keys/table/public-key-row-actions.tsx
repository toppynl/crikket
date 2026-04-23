"use client"

import { env } from "@crikket/env/web"
import { ConfirmationDialog } from "@crikket/ui/components/dialogs/confirmation-dialog"
import { Button } from "@crikket/ui/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crikket/ui/components/ui/dropdown-menu"
import {
  Copy,
  Edit3,
  FolderOpen,
  MoreVertical,
  RefreshCcw,
  ShieldOff,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import type { PublicKeyItem } from "../types"

interface PublicKeyRowActionsProps {
  canManage: boolean
  isAssigningToProject: boolean
  isDeleting: boolean
  isRevoking: boolean
  isRotating: boolean
  item: PublicKeyItem
  onAssignToProject: (keyId: string) => void
  onDelete: (input: { keyId: string }) => Promise<void>
  onEdit: (item: PublicKeyItem) => void
  onRevoke: (input: { keyId: string }) => Promise<void>
  onRotate: (input: { keyId: string }) => Promise<void>
}

function buildBundlerSnippet(input: { host: string; key: string }): string {
  return [
    'import { init } from "@crikket-io/capture"',
    "",
    "init({",
    `  key: "${input.key}",`,
    `  host: "${input.host}",`,
    "})",
  ].join("\n")
}

export function PublicKeyRowActions({
  canManage,
  isAssigningToProject,
  isDeleting,
  isRevoking,
  isRotating,
  item,
  onAssignToProject,
  onDelete,
  onEdit,
  onRevoke,
  onRotate,
}: PublicKeyRowActionsProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false)

  const copyValue = async (value: string, kind: "key" | "snippet") => {
    await navigator.clipboard.writeText(value)
    toast.success(kind === "key" ? "Public key copied" : "Embed snippet copied")
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Public key actions"
              disabled={!canManage}
              size="icon-sm"
              variant="outline"
            />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onClick={() =>
              copyValue(
                buildBundlerSnippet({
                  host: env.NEXT_PUBLIC_SERVER_URL,
                  key: item.key,
                }),
                "snippet"
              )
            }
          >
            <Copy />
            Copy embed snippet
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onEdit(item)}>
            <Edit3 />
            Edit details
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isAssigningToProject}
            onClick={() => onAssignToProject(item.id)}
          >
            <FolderOpen />
            {isAssigningToProject ? "Assigning..." : "Assign to project"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isRotating}
            onClick={() => onRotate({ keyId: item.id })}
          >
            <RefreshCcw />
            {isRotating ? "Rotating..." : "Rotate key"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={item.status === "revoked" || isRevoking}
            onClick={() => setIsRevokeDialogOpen(true)}
            variant="destructive"
          >
            <ShieldOff />
            {isRevoking ? "Revoking..." : "Revoke key"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={isDeleting}
            onClick={() => setIsDeleteDialogOpen(true)}
            variant="destructive"
          >
            <Trash2 />
            {isDeleting ? "Deleting..." : "Delete key"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmationDialog
        confirmText="Revoke key"
        description="This key will stop accepting widget submissions until it is rotated or replaced."
        isLoading={isRevoking}
        onConfirm={async () => {
          await onRevoke({ keyId: item.id })
        }}
        onOpenChange={setIsRevokeDialogOpen}
        open={isRevokeDialogOpen}
        title="Revoke public key?"
        variant="destructive"
      />

      <ConfirmationDialog
        confirmText="Delete key"
        description="This permanently deletes the public key. Any existing embed using it will stop working immediately."
        isLoading={isDeleting}
        onConfirm={async () => {
          await onDelete({ keyId: item.id })
        }}
        onOpenChange={setIsDeleteDialogOpen}
        open={isDeleteDialogOpen}
        title="Delete public key?"
        variant="destructive"
      />
    </>
  )
}
