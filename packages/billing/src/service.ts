import { db } from "@crikket/db"
import { member } from "@crikket/db/schema/auth"
import {
  billingWebhookEvent,
  organizationBillingAccount,
  organizationEntitlement,
} from "@crikket/db/schema/billing"
import { env } from "@crikket/env/server"
import { ORPCError } from "@orpc/server"
import { and, count, eq, sql } from "drizzle-orm"
import { polarClient } from "./lib/payments"
import {
  ACTIVE_PAID_SUBSCRIPTION_STATUSES,
  BILLING_PLAN,
  BILLING_SUBSCRIPTION_STATUS,
  type BillingPlan,
  type BillingPlanLimitSnapshot,
  type BillingSubscriptionStatus,
  type EntitlementSnapshot,
  getBillingDisabledEntitlements,
  getBillingDisabledPlanLimitsSnapshot,
  getBillingPlanLimitsSnapshot,
  normalizeBillingPlan,
  normalizeBillingSubscriptionStatus,
  resolveEntitlements,
} from "./model"

type BillingProjectionInput = {
  organizationId: string
  plan?: BillingPlan
  subscriptionStatus?: BillingSubscriptionStatus
  polarCustomerId?: string
  polarSubscriptionId?: string
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  cancelAtPeriodEnd?: boolean
  source?: string
}

type PolarWebhookPayload = {
  type?: string
  data?: unknown
  [key: string]: unknown
}

type PolarWebhookProcessingResult = {
  eventType: string
  ignored: boolean
  organizationId?: string
}

type ChangeOrganizationPlanResult =
  | {
      action: "updated"
      plan: BillingPlan
    }
  | {
      action: "checkout_required"
      plan: BillingPlan
      url: string
    }
  | {
      action: "unchanged"
      plan: BillingPlan
    }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function toDateOrUndefined(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function findFirstStringByKeys(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined {
  if (depth > 5) {
    return undefined
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstStringByKeys(entry, keys, depth + 1)
      if (found) {
        return found
      }
    }
    return undefined
  }

  const record = asRecord(value)
  if (!record) {
    return undefined
  }

  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  for (const nested of Object.values(record)) {
    const found = findFirstStringByKeys(nested, keys, depth + 1)
    if (found) {
      return found
    }
  }

  return undefined
}

function getNestedString(
  value: unknown,
  keys: readonly string[]
): string | undefined {
  let current: unknown = value
  for (const key of keys) {
    const record = asRecord(current)
    if (!record) {
      return undefined
    }
    current = record[key]
  }

  return typeof current === "string" && current.length > 0 ? current : undefined
}

function resolvePlanFromProductId(
  productId: string | undefined
): BillingPlan | undefined {
  if (!productId) {
    return undefined
  }

  if (productId === env.POLAR_STUDIO_PRODUCT_ID) {
    return BILLING_PLAN.studio
  }

  if (productId === env.POLAR_PRO_PRODUCT_ID) {
    return BILLING_PLAN.pro
  }

  return undefined
}

function extractReferenceId(payload: PolarWebhookPayload): string | undefined {
  return (
    getNestedString(payload, ["data", "referenceId"]) ??
    getNestedString(payload, ["data", "metadata", "referenceId"]) ??
    findFirstStringByKeys(payload.data, ["referenceId", "reference_id"])
  )
}

function extractProductId(payload: PolarWebhookPayload): string | undefined {
  return (
    getNestedString(payload, ["data", "productId"]) ??
    getNestedString(payload, ["data", "product", "id"]) ??
    getNestedString(payload, ["data", "productPrice", "productId"]) ??
    getNestedString(payload, ["data", "productPrice", "product", "id"]) ??
    findFirstStringByKeys(payload.data, ["productId", "product_id"])
  )
}

function extractSubscriptionStatus(
  payload: PolarWebhookPayload
): BillingSubscriptionStatus | undefined {
  const rawStatus =
    getNestedString(payload, ["data", "status"]) ??
    getNestedString(payload, ["data", "subscription", "status"])

  return rawStatus ? normalizeBillingSubscriptionStatus(rawStatus) : undefined
}

function extractCustomerId(payload: PolarWebhookPayload): string | undefined {
  return (
    getNestedString(payload, ["data", "customerId"]) ??
    getNestedString(payload, ["data", "customer", "id"])
  )
}

function extractSubscriptionId(
  payload: PolarWebhookPayload
): string | undefined {
  return (
    getNestedString(payload, ["data", "subscriptionId"]) ??
    getNestedString(payload, ["data", "id"]) ??
    getNestedString(payload, ["data", "subscription", "id"])
  )
}

function extractCurrentPeriodStart(
  payload: PolarWebhookPayload
): Date | undefined {
  const value =
    getNestedString(payload, ["data", "currentPeriodStart"]) ??
    getNestedString(payload, ["data", "currentPeriodStartAt"])

  return toDateOrUndefined(value)
}

function extractCurrentPeriodEnd(
  payload: PolarWebhookPayload
): Date | undefined {
  const value =
    getNestedString(payload, ["data", "currentPeriodEnd"]) ??
    getNestedString(payload, ["data", "currentPeriodEndAt"]) ??
    getNestedString(payload, ["data", "endedAt"])

  return toDateOrUndefined(value)
}

function extractCancelAtPeriodEnd(
  payload: PolarWebhookPayload
): boolean | undefined {
  const value =
    asRecord(payload.data)?.cancelAtPeriodEnd ??
    getNestedString(payload, ["data", "cancelAtPeriodEnd"])
  if (typeof value === "boolean") {
    return value
  }

  if (value === "true") {
    return true
  }

  if (value === "false") {
    return false
  }

  return undefined
}

function extractProviderEventId(
  payload: PolarWebhookPayload,
  eventType: string
): string {
  const eventId =
    getNestedString(payload, ["id"]) ??
    getNestedString(payload, ["data", "eventId"]) ??
    getNestedString(payload, ["data", "event_id"])

  if (eventId && eventId.length > 0) {
    return `polar:event:${eventId}`
  }

  const secondaryId =
    getNestedString(payload, ["data", "id"]) ??
    getNestedString(payload, ["data", "subscriptionId"]) ??
    getNestedString(payload, ["data", "subscription_id"]) ??
    getNestedString(payload, ["data", "checkoutId"]) ??
    getNestedString(payload, ["data", "checkout_id"]) ??
    "unknown"
  const timestamp =
    getNestedString(payload, ["createdAt"]) ??
    getNestedString(payload, ["data", "createdAt"]) ??
    getNestedString(payload, ["data", "created_at"]) ??
    crypto.randomUUID()

  return `polar:fallback:${eventType}:${secondaryId}:${timestamp}`
}

export function upsertOrganizationBillingProjection(
  input: BillingProjectionInput
): Promise<EntitlementSnapshot> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.organizationBillingAccount.findFirst({
      where: eq(
        organizationBillingAccount.organizationId,
        input.organizationId
      ),
      columns: {
        plan: true,
        subscriptionStatus: true,
      },
    })

    const nextPlan = normalizeBillingPlan(input.plan ?? existing?.plan)
    const nextSubscriptionStatus = normalizeBillingSubscriptionStatus(
      input.subscriptionStatus ?? existing?.subscriptionStatus
    )
    const entitlements = resolveEntitlements({
      plan: nextPlan,
      subscriptionStatus: nextSubscriptionStatus,
    })

    await tx
      .insert(organizationBillingAccount)
      .values({
        organizationId: input.organizationId,
        provider: "polar",
        polarCustomerId: input.polarCustomerId,
        polarSubscriptionId: input.polarSubscriptionId,
        plan: nextPlan,
        subscriptionStatus: nextSubscriptionStatus,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        lastWebhookAt: new Date(),
      })
      .onConflictDoUpdate({
        target: organizationBillingAccount.organizationId,
        set: {
          polarCustomerId:
            input.polarCustomerId ?? organizationBillingAccount.polarCustomerId,
          polarSubscriptionId:
            input.polarSubscriptionId ??
            organizationBillingAccount.polarSubscriptionId,
          plan: nextPlan,
          subscriptionStatus: nextSubscriptionStatus,
          currentPeriodStart:
            input.currentPeriodStart ??
            organizationBillingAccount.currentPeriodStart,
          currentPeriodEnd:
            input.currentPeriodEnd ??
            organizationBillingAccount.currentPeriodEnd,
          cancelAtPeriodEnd:
            input.cancelAtPeriodEnd ??
            organizationBillingAccount.cancelAtPeriodEnd,
          lastWebhookAt: new Date(),
          updatedAt: new Date(),
        },
      })

    await tx
      .insert(organizationEntitlement)
      .values({
        organizationId: input.organizationId,
        plan: nextPlan,
        canCreateBugReports: entitlements.canCreateBugReports,
        canUploadVideo: entitlements.canUploadVideo,
        maxVideoDurationMs: entitlements.maxVideoDurationMs,
        memberCap: entitlements.memberCap,
        lastComputedAt: new Date(),
        source: input.source ?? "reconciliation",
      })
      .onConflictDoUpdate({
        target: organizationEntitlement.organizationId,
        set: {
          plan: nextPlan,
          canCreateBugReports: entitlements.canCreateBugReports,
          canUploadVideo: entitlements.canUploadVideo,
          maxVideoDurationMs: entitlements.maxVideoDurationMs,
          memberCap: entitlements.memberCap,
          lastComputedAt: new Date(),
          source: input.source ?? "reconciliation",
          updatedAt: new Date(),
        },
      })

    return entitlements
  })
}

export async function getOrganizationEntitlements(
  organizationId: string
): Promise<EntitlementSnapshot> {
  if (!env.ENABLE_PAYMENTS) {
    return getBillingDisabledEntitlements()
  }

  const row = await db.query.organizationEntitlement.findFirst({
    where: eq(organizationEntitlement.organizationId, organizationId),
    columns: {
      plan: true,
      canCreateBugReports: true,
      canUploadVideo: true,
      maxVideoDurationMs: true,
      memberCap: true,
    },
  })

  if (row) {
    return {
      plan: normalizeBillingPlan(row.plan),
      canCreateBugReports: row.canCreateBugReports,
      canUploadVideo: row.canUploadVideo,
      maxVideoDurationMs: row.maxVideoDurationMs,
      memberCap: row.memberCap,
    }
  }

  return resolveEntitlements({
    plan: BILLING_PLAN.free,
    subscriptionStatus: BILLING_SUBSCRIPTION_STATUS.none,
  })
}

export async function getOrganizationBillingSnapshot(organizationId: string) {
  const [billingRow, entitlement, memberCountResult] = await Promise.all([
    db.query.organizationBillingAccount.findFirst({
      where: eq(organizationBillingAccount.organizationId, organizationId),
      columns: {
        plan: true,
        subscriptionStatus: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    }),
    getOrganizationEntitlements(organizationId),
    db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
  ])

  return {
    organizationId,
    plan: normalizeBillingPlan(billingRow?.plan),
    subscriptionStatus: normalizeBillingSubscriptionStatus(
      billingRow?.subscriptionStatus
    ),
    currentPeriodStart: billingRow?.currentPeriodStart ?? null,
    currentPeriodEnd: billingRow?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: billingRow?.cancelAtPeriodEnd ?? false,
    memberCount: memberCountResult[0]?.value ?? 0,
    entitlements: entitlement,
  }
}

export function getBillingPlanLimits(): Record<
  BillingPlan,
  BillingPlanLimitSnapshot
> {
  if (!env.ENABLE_PAYMENTS) {
    return getBillingDisabledPlanLimitsSnapshot()
  }

  return getBillingPlanLimitsSnapshot()
}

export async function recomputeOrganizationEntitlements(
  organizationId: string
) {
  const billingRow = await db.query.organizationBillingAccount.findFirst({
    where: eq(organizationBillingAccount.organizationId, organizationId),
    columns: {
      plan: true,
      subscriptionStatus: true,
      polarCustomerId: true,
      polarSubscriptionId: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  })

  const plan = normalizeBillingPlan(billingRow?.plan)
  const subscriptionStatus = normalizeBillingSubscriptionStatus(
    billingRow?.subscriptionStatus
  )
  const entitlements = await upsertOrganizationBillingProjection({
    organizationId,
    plan,
    subscriptionStatus,
    polarCustomerId: billingRow?.polarCustomerId ?? undefined,
    polarSubscriptionId: billingRow?.polarSubscriptionId ?? undefined,
    currentPeriodStart: billingRow?.currentPeriodStart ?? undefined,
    currentPeriodEnd: billingRow?.currentPeriodEnd ?? undefined,
    cancelAtPeriodEnd: billingRow?.cancelAtPeriodEnd ?? false,
    source: "manual-recompute",
  })

  return {
    organizationId,
    plan,
    subscriptionStatus,
    entitlements,
  }
}

async function resolveOrganizationIdFromWebhookPayload(
  payload: PolarWebhookPayload
): Promise<string | undefined> {
  const referenceId = extractReferenceId(payload)
  if (referenceId) {
    return referenceId
  }

  const subscriptionId = extractSubscriptionId(payload)
  if (subscriptionId) {
    const billingAccountBySubscription =
      await db.query.organizationBillingAccount.findFirst({
        where: eq(
          organizationBillingAccount.polarSubscriptionId,
          subscriptionId
        ),
        columns: {
          organizationId: true,
        },
      })
    if (billingAccountBySubscription?.organizationId) {
      return billingAccountBySubscription.organizationId
    }
  }

  const customerId = extractCustomerId(payload)
  if (!customerId) {
    return undefined
  }

  const billingAccountByCustomer =
    await db.query.organizationBillingAccount.findFirst({
      where: eq(organizationBillingAccount.polarCustomerId, customerId),
      columns: {
        organizationId: true,
      },
    })
  return billingAccountByCustomer?.organizationId
}

export async function assertOrganizationCanAddMembers(
  organizationId: string,
  incomingMembers = 1
): Promise<void> {
  const entitlements = await getOrganizationEntitlements(organizationId)
  const memberCap = entitlements.memberCap

  if (memberCap === null) {
    return
  }

  const memberCountResult = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  const memberCount = memberCountResult[0]?.value ?? 0

  if (memberCount + incomingMembers <= memberCap) {
    return
  }

  if (entitlements.plan === BILLING_PLAN.pro) {
    throw new Error(
      `Pro plan supports up to ${memberCap} members. Upgrade to Studio to add more teammates.`
    )
  }

  if (entitlements.plan === BILLING_PLAN.free) {
    throw new Error("Upgrade to Pro to invite teammates to this organization.")
  }

  throw new Error("Organization member limit reached.")
}

export async function processPolarWebhookPayload(
  payload: PolarWebhookPayload
): Promise<PolarWebhookProcessingResult> {
  const eventType =
    (typeof payload.type === "string" && payload.type.length > 0
      ? payload.type
      : "unknown") ?? "unknown"
  const providerEventId = extractProviderEventId(payload, eventType)

  const [existingWebhook] = await db
    .select({
      status: billingWebhookEvent.status,
    })
    .from(billingWebhookEvent)
    .where(eq(billingWebhookEvent.providerEventId, providerEventId))
    .limit(1)

  if (existingWebhook?.status === "processed") {
    return {
      eventType,
      ignored: true,
    }
  }

  if (existingWebhook) {
    await db
      .update(billingWebhookEvent)
      .set({
        status: "received",
        errorMessage: null,
        attemptCount: sql`${billingWebhookEvent.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvent.providerEventId, providerEventId))
  } else {
    await db.insert(billingWebhookEvent).values({
      id: crypto.randomUUID(),
      providerEventId,
      provider: "polar",
      eventType,
      status: "received",
      payload,
      attemptCount: 1,
    })
  }

  try {
    const organizationId =
      await resolveOrganizationIdFromWebhookPayload(payload)
    if (!organizationId) {
      await db
        .update(billingWebhookEvent)
        .set({
          status: "ignored",
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(billingWebhookEvent.providerEventId, providerEventId))

      return {
        eventType,
        ignored: true,
      }
    }

    const productId = extractProductId(payload)
    const plan = resolvePlanFromProductId(productId)
    const isSubscriptionEvent = eventType.startsWith("subscription.")
    const subscriptionStatus = isSubscriptionEvent
      ? extractSubscriptionStatus(payload)
      : undefined
    const polarCustomerId = extractCustomerId(payload)
    const polarSubscriptionId = extractSubscriptionId(payload)
    const currentPeriodStart = isSubscriptionEvent
      ? extractCurrentPeriodStart(payload)
      : undefined
    const currentPeriodEnd = isSubscriptionEvent
      ? extractCurrentPeriodEnd(payload)
      : undefined
    const cancelAtPeriodEnd = isSubscriptionEvent
      ? extractCancelAtPeriodEnd(payload)
      : undefined

    await upsertOrganizationBillingProjection({
      organizationId,
      plan,
      subscriptionStatus,
      polarCustomerId,
      polarSubscriptionId,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      source: "webhook",
    })

    await db
      .update(billingWebhookEvent)
      .set({
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvent.providerEventId, providerEventId))

    return {
      eventType,
      ignored: false,
      organizationId,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown webhook processing error"

    await db
      .update(billingWebhookEvent)
      .set({
        status: "failed",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvent.providerEventId, providerEventId))

    throw error
  }
}

export async function assertUserBelongsToOrganization(input: {
  organizationId: string
  userId: string
}): Promise<void> {
  const organizationMember = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.organizationId),
      eq(member.userId, input.userId)
    ),
    columns: {
      id: true,
    },
  })

  if (!organizationMember) {
    throw new Error("You do not have access to this organization.")
  }
}

async function assertUserCanManageOrganizationBilling(input: {
  organizationId: string
  userId: string
}): Promise<void> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.organizationId),
      eq(member.userId, input.userId)
    ),
    columns: {
      role: true,
    },
  })

  if (!membership) {
    throw new ORPCError("FORBIDDEN", {
      message: "You do not have access to this organization.",
    })
  }

  if (membership.role !== "owner") {
    throw new ORPCError("FORBIDDEN", {
      message: "Only organization owners can manage billing.",
    })
  }
}

function resolveProductIdByPlan(plan: "pro" | "studio"): string {
  const productId =
    plan === "studio" ? env.POLAR_STUDIO_PRODUCT_ID : env.POLAR_PRO_PRODUCT_ID
  if (!productId) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `POLAR_${plan.toUpperCase()}_PRODUCT_ID is not configured.`,
    })
  }

  return productId
}

function assertPaymentsEnabled(): void {
  if (env.ENABLE_PAYMENTS) {
    return
  }

  throw new ORPCError("BAD_REQUEST", {
    message: "Payments are disabled in this deployment.",
  })
}

export async function createOrganizationCheckoutSession(input: {
  organizationId: string
  plan: "pro" | "studio"
  userId: string
}): Promise<{ url: string }> {
  assertPaymentsEnabled()

  await assertUserCanManageOrganizationBilling({
    organizationId: input.organizationId,
    userId: input.userId,
  })

  if (!env.POLAR_SUCCESS_URL) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "POLAR_SUCCESS_URL is not configured.",
    })
  }

  const productId = resolveProductIdByPlan(input.plan)

  const existingBillingAccount =
    await db.query.organizationBillingAccount.findFirst({
      where: eq(
        organizationBillingAccount.organizationId,
        input.organizationId
      ),
      columns: {
        polarCustomerId: true,
      },
    })

  try {
    const checkout = await polarClient.checkouts.create({
      customerId: existingBillingAccount?.polarCustomerId,
      externalCustomerId: existingBillingAccount?.polarCustomerId
        ? undefined
        : input.organizationId,
      products: [productId],
      successUrl: env.POLAR_SUCCESS_URL,
      metadata: {
        initiatedByUserId: input.userId,
        plan: input.plan,
        referenceId: input.organizationId,
        source: "crikket-billing-checkout",
      },
    })

    return { url: checkout.url }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create checkout session"

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}

export async function changeOrganizationPlan(input: {
  organizationId: string
  plan: "pro" | "studio"
  userId: string
}): Promise<ChangeOrganizationPlanResult> {
  assertPaymentsEnabled()

  await assertUserCanManageOrganizationBilling({
    organizationId: input.organizationId,
    userId: input.userId,
  })

  const billingAccount = await db.query.organizationBillingAccount.findFirst({
    where: eq(organizationBillingAccount.organizationId, input.organizationId),
    columns: {
      plan: true,
      subscriptionStatus: true,
      polarCustomerId: true,
      polarSubscriptionId: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  })

  const nextPlan = normalizeBillingPlan(input.plan)
  const currentPlan = normalizeBillingPlan(billingAccount?.plan)
  const currentSubscriptionStatus = normalizeBillingSubscriptionStatus(
    billingAccount?.subscriptionStatus
  )

  if (currentPlan === nextPlan) {
    return {
      action: "unchanged",
      plan: nextPlan,
    }
  }

  const subscriptionId = billingAccount?.polarSubscriptionId
  const hasActivePaidSubscription =
    typeof subscriptionId === "string" &&
    subscriptionId.length > 0 &&
    ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(currentSubscriptionStatus)

  if (!(billingAccount && hasActivePaidSubscription)) {
    const checkout = await createOrganizationCheckoutSession({
      organizationId: input.organizationId,
      plan: input.plan,
      userId: input.userId,
    })

    return {
      action: "checkout_required",
      plan: nextPlan,
      url: checkout.url,
    }
  }

  const targetProductId = resolveProductIdByPlan(input.plan)

  try {
    const subscription = await polarClient.subscriptions.update({
      id: subscriptionId,
      subscriptionUpdate: {
        productId: targetProductId,
      },
    })

    const resolvedPlan =
      resolvePlanFromProductId(subscription.productId) ??
      normalizeBillingPlan(input.plan)
    const resolvedSubscriptionStatus = normalizeBillingSubscriptionStatus(
      subscription.status
    )

    await upsertOrganizationBillingProjection({
      organizationId: input.organizationId,
      plan: resolvedPlan,
      subscriptionStatus: resolvedSubscriptionStatus,
      polarCustomerId:
        subscription.customerId ?? billingAccount.polarCustomerId ?? undefined,
      polarSubscriptionId: subscription.id,
      currentPeriodStart:
        subscription.currentPeriodStart ??
        billingAccount.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        subscription.currentPeriodEnd ??
        billingAccount.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        subscription.cancelAtPeriodEnd ??
        billingAccount.cancelAtPeriodEnd ??
        false,
      source: "manual-change-plan",
    })

    return {
      action: "updated",
      plan: resolvedPlan,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to change organization plan"

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}

export async function createOrganizationPortalSession(input: {
  organizationId: string
  userId: string
}): Promise<{ url: string }> {
  assertPaymentsEnabled()

  await assertUserCanManageOrganizationBilling({
    organizationId: input.organizationId,
    userId: input.userId,
  })

  const billingAccount = await db.query.organizationBillingAccount.findFirst({
    where: eq(organizationBillingAccount.organizationId, input.organizationId),
    columns: {
      polarCustomerId: true,
    },
  })

  if (!billingAccount?.polarCustomerId) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "No billing customer found for this organization. Start a Pro or Studio checkout first.",
    })
  }

  try {
    const customerSession = await polarClient.customerSessions.create({
      customerId: billingAccount.polarCustomerId,
      returnUrl: env.POLAR_SUCCESS_URL ?? undefined,
    })

    return { url: customerSession.customerPortalUrl }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create customer portal session"

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}
