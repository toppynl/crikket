import { db } from "@crikket/db"
import { organizationBillingAccount } from "@crikket/db/schema/billing"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"
import { getPolarClient } from "../../lib/payments"
import {
  normalizeBillingPlan,
  normalizeBillingSubscriptionStatus,
} from "../../model"
import { assertUserCanManageOrganizationBilling } from "../access"
import { upsertOrganizationBillingProjection } from "../entitlements/projection"
import { resolvePlanFromProductId } from "../polar-payload"
import type { ChangeOrganizationPlanResult } from "../types"
import { getErrorMessage } from "../utils"
import { createOrganizationCheckoutSession } from "./checkout-session"
import { assertPaymentsEnabled, resolveProductIdByPlan } from "./shared"
import { findUpdatableSubscription } from "./subscription-discovery"
import type { BillingInterval } from "./types"

export async function changeOrganizationPlan(input: {
  organizationId: string
  plan: "pro" | "studio"
  billingInterval?: BillingInterval
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
      polarCustomerId: true,
      polarSubscriptionId: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  })

  const nextPlan = normalizeBillingPlan(input.plan)
  const billingInterval = input.billingInterval ?? "monthly"
  const targetProductId = resolveProductIdByPlan({
    plan: input.plan,
    billingInterval,
  })

  const updatableSubscription = await findUpdatableSubscription({
    organizationId: input.organizationId,
    billingAccount,
  }).catch((error) => {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: getErrorMessage(
        error,
        "Failed to resolve existing subscription"
      ),
    })
  })

  if (!updatableSubscription) {
    const checkout = await createOrganizationCheckoutSession({
      billingInterval,
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

  const currentPlan = normalizeBillingPlan(
    resolvePlanFromProductId(updatableSubscription.productId)
  )
  const isSamePlanAndCadence =
    currentPlan === nextPlan &&
    updatableSubscription.productId === targetProductId

  if (isSamePlanAndCadence) {
    const resolvedSubscriptionStatus = normalizeBillingSubscriptionStatus(
      updatableSubscription.status
    )

    await upsertOrganizationBillingProjection({
      organizationId: input.organizationId,
      plan: currentPlan,
      subscriptionStatus: resolvedSubscriptionStatus,
      polarCustomerId:
        updatableSubscription.customerId ??
        billingAccount?.polarCustomerId ??
        undefined,
      polarSubscriptionId: updatableSubscription.id,
      currentPeriodStart:
        updatableSubscription.currentPeriodStart ??
        billingAccount?.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        updatableSubscription.currentPeriodEnd ??
        billingAccount?.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        updatableSubscription.cancelAtPeriodEnd ??
        billingAccount?.cancelAtPeriodEnd ??
        false,
      source: "manual-change-plan",
    })

    return {
      action: "unchanged",
      plan: nextPlan,
    }
  }

  try {
    const subscription = await getPolarClient().subscriptions.update({
      id: updatableSubscription.id,
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
        subscription.customerId ??
        updatableSubscription.customerId ??
        billingAccount?.polarCustomerId ??
        undefined,
      polarSubscriptionId: subscription.id,
      currentPeriodStart:
        subscription.currentPeriodStart ??
        updatableSubscription.currentPeriodStart ??
        billingAccount?.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        subscription.currentPeriodEnd ??
        updatableSubscription.currentPeriodEnd ??
        billingAccount?.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        subscription.cancelAtPeriodEnd ??
        updatableSubscription.cancelAtPeriodEnd ??
        billingAccount?.cancelAtPeriodEnd ??
        false,
      source: "manual-change-plan",
    })

    return {
      action: "updated",
      plan: resolvedPlan,
    }
  } catch (error) {
    const message = getErrorMessage(error, "Failed to change organization plan")

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}
