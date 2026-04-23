"use client"

import { Button } from "@crikket/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crikket/ui/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crikket/ui/components/ui/select"
import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import * as React from "react"

import { client } from "@/utils/orpc"

import { PublicKeyCreateForm } from "./forms/public-key-create-form"
import { PublicKeyForm } from "./forms/public-key-form"
import { usePublicKeyActions } from "./hooks/use-public-key-actions"
import { usePublicKeysData } from "./hooks/use-public-keys-data"
import { PublicKeysTable } from "./table/public-keys-table"
import type { PublicKeysSnapshot } from "./types"

interface PublicKeysManagementProps {
  canManage: boolean
  initialKeys: PublicKeysSnapshot
}

export function PublicKeysManagement({
  canManage,
  initialKeys,
}: PublicKeysManagementProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false)
  const [editingItem, setEditingItem] = React.useState<
    PublicKeysSnapshot[number] | null
  >(null)
  const [assigningKeyId, setAssigningKeyId] = React.useState<string | null>(
    null
  )
  const [selectedProjectId, setSelectedProjectId] = React.useState<
    string | null
  >(null)

  const keysQuery = usePublicKeysData(initialKeys)
  const {
    assignToProjectMutation,
    createMutation,
    deleteMutation,
    revokeMutation,
    rotateMutation,
    updateMutation,
  } = usePublicKeyActions()

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => client.project.list(),
  })

  const keys = keysQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const updatingKeyId = updateMutation.variables?.keyId ?? null

  const assigningKey = assigningKeyId
    ? keys.find((k) => k.id === assigningKeyId) ?? null
    : null

  function openAssignDialog(keyId: string) {
    const key = keys.find((k) => k.id === keyId) ?? null
    setAssigningKeyId(keyId)
    setSelectedProjectId(key?.projectId ?? null)
  }

  function closeAssignDialog() {
    setAssigningKeyId(null)
    setSelectedProjectId(null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Public Keys</CardTitle>
            <CardDescription>
              Create one public key per owned website or app surface, then use
              the operations menu to copy the embed snippet, rotate, revoke, or
              delete it.
            </CardDescription>
          </div>
          <Button
            disabled={!canManage}
            onClick={() => setIsCreateDialogOpen(true)}
            type="button"
          >
            <Plus />
            Create key
          </Button>
        </CardHeader>
        <CardContent>
          {keys.length > 0 ? (
            <PublicKeysTable
              assigningToProjectKeyId={
                assignToProjectMutation.isPending
                  ? (assignToProjectMutation.variables?.keyId ?? null)
                  : null
              }
              canManage={canManage}
              deletingKeyId={
                deleteMutation.isPending
                  ? (deleteMutation.variables?.keyId ?? null)
                  : null
              }
              items={keys}
              onAssignToProject={openAssignDialog}
              onDelete={async (input) => {
                await deleteMutation.mutateAsync(input)
              }}
              onEdit={(item) => {
                setEditingItem(item)
              }}
              onRevoke={async (input) => {
                await revokeMutation.mutateAsync(input)
              }}
              onRotate={async (input) => {
                await rotateMutation.mutateAsync(input)
              }}
              revokingKeyId={
                revokeMutation.isPending
                  ? (revokeMutation.variables?.keyId ?? null)
                  : null
              }
              rotatingKeyId={
                rotateMutation.isPending
                  ? (rotateMutation.variables?.keyId ?? null)
                  : null
              }
            />
          ) : (
            <div className="text-muted-foreground text-sm">
              No public keys yet. Create your first key to embed the widget on
              an owned website.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog onOpenChange={setIsCreateDialogOpen} open={isCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create public key</DialogTitle>
            <DialogDescription>
              Add a site-scoped public key and the exact origins where the
              widget is allowed to run.
            </DialogDescription>
          </DialogHeader>
          <PublicKeyCreateForm
            isPending={!canManage || createMutation.isPending}
            onSubmit={async (input) => {
              await createMutation.mutateAsync(input)
              setIsCreateDialogOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setEditingItem(null)
          }
        }}
        open={editingItem !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit public key</DialogTitle>
            <DialogDescription>
              Update the label and exact HTTP(S) origins where this public key
              is allowed to run.
            </DialogDescription>
          </DialogHeader>
          {editingItem ? (
            <PublicKeyForm
              defaultValues={{
                allowedOrigins: editingItem.allowedOrigins,
                label: editingItem.label,
              }}
              isPending={
                !canManage ||
                (updateMutation.isPending && updatingKeyId === editingItem.id)
              }
              onSubmit={async (input) => {
                await updateMutation.mutateAsync({
                  ...input,
                  keyId: editingItem.id,
                })
                setEditingItem(null)
              }}
              submitLabel="Save changes"
              submittingLabel="Saving..."
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && closeAssignDialog()} open={assigningKeyId !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign to project</DialogTitle>
            <DialogDescription>
              {assigningKey
                ? `Select the project for "${assigningKey.label}", or clear to remove the assignment.`
                : "Select a project to assign this key to."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select
              onValueChange={(value) =>
                setSelectedProjectId(value === "__none__" ? null : value)
              }
              value={selectedProjectId ?? "__none__"}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button
                onClick={closeAssignDialog}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={assignToProjectMutation.isPending}
                onClick={async () => {
                  if (!assigningKeyId) return
                  await assignToProjectMutation.mutateAsync({
                    keyId: assigningKeyId,
                    projectId: selectedProjectId,
                  })
                  closeAssignDialog()
                }}
                type="button"
              >
                {assignToProjectMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
