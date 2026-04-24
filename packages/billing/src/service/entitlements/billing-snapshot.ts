import { db } from "@crikket/db"
import { member } from "@crikket/db/schema/auth"
import { organizationBillingAccount } from "@crikket/db/schema/billing"
import { env } from "@crikket/env/server"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { count, eq } from "drizzle-orm"

import { getPolarClient } from "../../lib/payments"
import {
  ACTIVE_PAID_SUBSCRIPTION_STATUSES,
  BILLING_PLAN,
  type EntitlementSnapshot,
  normalizeBillingPlan,
  normalizeBillingSubscriptionStatus,
} from "../../model"
import { collectPaginatedPolarItems } from "../polar-pagination"
import { resolvePlanFromProductId } from "../polar-payload"
import type { OrganizationBillingSnapshot } from "../types"
import { getOrganizationEntitlements } from "./organization-entitlements"
import { upsertOrganizationBillingProjection } from "./projection"

type BillingSnapshotRow = {
  plan: string
  subscriptionStatus: string
  polarCustomerId: string | null
  polarSubscriptionId: string | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

type RecoverableBillingSnapshotRow = BillingSnapshotRow & {
  polarSubscriptionId: string
}

type PolarSubscription = Awaited<
  ReturnType<ReturnType<typeof getPolarClient>["subscriptions"]["get"]>
>

function isActivePaidSubscriptionStatus(status: unknown): boolean {
  return ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(
    normalizeBillingSubscriptionStatus(status)
  )
}

function resolveSubscriptionRecencyScore(
  subscription: PolarSubscription
): number {
  const periodEnd = subscription.currentPeriodEnd?.getTime() ?? 0
  if (periodEnd > 0) {
    return periodEnd
  }

  return subscription.currentPeriodStart.getTime()
}

function selectMostRecentActiveSubscription(
  subscriptions: PolarSubscription[]
): PolarSubscription | null {
  if (subscriptions.length === 0) {
    return null
  }

  return subscriptions.reduce((latest, current) => {
    const latestScore = resolveSubscriptionRecencyScore(latest)
    const currentScore = resolveSubscriptionRecencyScore(current)
    return currentScore > latestScore ? current : latest
  })
}

function canRecoverBillingSnapshotFromSubscription(
  billingRow: BillingSnapshotRow | undefined
): billingRow is RecoverableBillingSnapshotRow {
  if (!(env.ENABLE_PAYMENTS && billingRow?.polarSubscriptionId)) {
    return false
  }

  return !(
    billingRow.currentPeriodStart &&
    billingRow.currentPeriodEnd &&
    billingRow.polarCustomerId
  )
}

function shouldRecoverBillingSnapshotFromMetadata(
  billingRow: BillingSnapshotRow | undefined
): boolean {
  if (!env.ENABLE_PAYMENTS) {
    return false
  }

  if (!billingRow) {
    return true
  }

  const normalizedPlan = normalizeBillingPlan(billingRow.plan)
  const normalizedStatus = normalizeBillingSubscriptionStatus(
    billingRow.subscriptionStatus
  )
  const hasCompleteSubscriptionPointers = Boolean(
    billingRow.polarSubscriptionId &&
      billingRow.polarCustomerId &&
      billingRow.currentPeriodStart &&
      billingRow.currentPeriodEnd
  )

  return !(
    normalizedPlan !== BILLING_PLAN.free &&
    ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(normalizedStatus) &&
    hasCompleteSubscriptionPointers
  )
}

async function recoverBillingSnapshotFromSubscription(input: {
  organizationId: string
  billingRow: RecoverableBillingSnapshotRow
}): Promise<{
  billingRow: BillingSnapshotRow
  entitlements: EntitlementSnapshot
} | null> {
  try {
    const subscription = await getPolarClient().subscriptions.get({
      id: input.billingRow.polarSubscriptionId,
    })
    const recoveredPlan =
      resolvePlanFromProductId(subscription.productId) ??
      normalizeBillingPlan(input.billingRow.plan)
    const recoveredSubscriptionStatus = normalizeBillingSubscriptionStatus(
      subscription.status
    )

    const entitlements = await upsertOrganizationBillingProjection({
      organizationId: input.organizationId,
      plan: recoveredPlan,
      subscriptionStatus: recoveredSubscriptionStatus,
      polarCustomerId:
        subscription.customerId ??
        input.billingRow.polarCustomerId ??
        undefined,
      polarSubscriptionId:
        subscription.id ?? input.billingRow.polarSubscriptionId,
      currentPeriodStart:
        subscription.currentPeriodStart ??
        input.billingRow.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        subscription.currentPeriodEnd ??
        input.billingRow.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        subscription.cancelAtPeriodEnd ??
        input.billingRow.cancelAtPeriodEnd ??
        false,
      source: "snapshot-recovery",
    })

    return {
      entitlements,
      billingRow: {
        ...input.billingRow,
        plan: recoveredPlan,
        subscriptionStatus: recoveredSubscriptionStatus,
        polarCustomerId:
          subscription.customerId ?? input.billingRow.polarCustomerId,
        polarSubscriptionId:
          subscription.id ?? input.billingRow.polarSubscriptionId,
        currentPeriodStart:
          subscription.currentPeriodStart ??
          input.billingRow.currentPeriodStart,
        currentPeriodEnd:
          subscription.currentPeriodEnd ?? input.billingRow.currentPeriodEnd,
        cancelAtPeriodEnd:
          subscription.cancelAtPeriodEnd ??
          input.billingRow.cancelAtPeriodEnd ??
          false,
      },
    }
  } catch (error) {
    reportNonFatalError(
      "Failed to recover organization billing snapshot from subscription",
      error
    )
    return null
  }
}

async function recoverBillingSnapshotFromMetadata(input: {
  organizationId: string
  billingRow: BillingSnapshotRow | undefined
}): Promise<{
  billingRow: BillingSnapshotRow
  entitlements: EntitlementSnapshot
} | null> {
  try {
    const subscriptions = await collectPaginatedPolarItems({
      fetchPage: (page, limit) =>
        getPolarClient().subscriptions.list({
          active: true,
          limit,
          metadata: { referenceId: input.organizationId },
          page,
        }),
    })
    const paidSubscriptions = subscriptions.filter((subscription) =>
      isActivePaidSubscriptionStatus(subscription.status)
    )
    const activeSubscription =
      selectMostRecentActiveSubscription(paidSubscriptions)
    if (!activeSubscription) {
      return null
    }

    const recoveredPlan =
      resolvePlanFromProductId(activeSubscription.productId) ??
      normalizeBillingPlan(input.billingRow?.plan)
    const recoveredSubscriptionStatus = normalizeBillingSubscriptionStatus(
      activeSubscription.status
    )
    const entitlements = await upsertOrganizationBillingProjection({
      organizationId: input.organizationId,
      plan: recoveredPlan,
      subscriptionStatus: recoveredSubscriptionStatus,
      polarCustomerId: activeSubscription.customerId,
      polarSubscriptionId: activeSubscription.id,
      currentPeriodStart: activeSubscription.currentPeriodStart,
      currentPeriodEnd: activeSubscription.currentPeriodEnd ?? undefined,
      cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
      source: "snapshot-recovery",
    })

    return {
      entitlements,
      billingRow: {
        plan: recoveredPlan,
        subscriptionStatus: recoveredSubscriptionStatus,
        polarCustomerId: activeSubscription.customerId,
        polarSubscriptionId: activeSubscription.id,
        currentPeriodStart: activeSubscription.currentPeriodStart,
        currentPeriodEnd: activeSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
      },
    }
  } catch (error) {
    reportNonFatalError(
      "Failed to recover organization billing snapshot from metadata",
      error
    )
    return null
  }
}

export async function getOrganizationBillingSnapshot(
  organizationId: string
): Promise<OrganizationBillingSnapshot> {
  const [billingRow, memberCountResult] = await Promise.all([
    db.query.organizationBillingAccount.findFirst({
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
    }),
    db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
  ])

  let resolvedBillingRow = billingRow
  let resolvedEntitlement: EntitlementSnapshot | null = null

  if (canRecoverBillingSnapshotFromSubscription(billingRow)) {
    const recovery = await recoverBillingSnapshotFromSubscription({
      organizationId,
      billingRow,
    })
    if (recovery) {
      resolvedBillingRow = recovery.billingRow
      resolvedEntitlement = recovery.entitlements
    }
  }

  if (
    !resolvedEntitlement &&
    shouldRecoverBillingSnapshotFromMetadata(resolvedBillingRow)
  ) {
    const metadataRecovery = await recoverBillingSnapshotFromMetadata({
      organizationId,
      billingRow: resolvedBillingRow,
    })
    if (metadataRecovery) {
      resolvedBillingRow = metadataRecovery.billingRow
      resolvedEntitlement = metadataRecovery.entitlements
    }
  }

  const entitlement =
    resolvedEntitlement ?? (await getOrganizationEntitlements(organizationId))

  return {
    organizationId,
    plan: entitlement.plan,
    subscriptionStatus: normalizeBillingSubscriptionStatus(
      resolvedBillingRow?.subscriptionStatus
    ),
    currentPeriodStart: resolvedBillingRow?.currentPeriodStart ?? null,
    currentPeriodEnd: resolvedBillingRow?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: resolvedBillingRow?.cancelAtPeriodEnd ?? false,
    memberCount: memberCountResult[0]?.value ?? 0,
    entitlements: entitlement,
  }
}
