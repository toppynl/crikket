import { reportNonFatalError } from "@crikket/shared/lib/errors"

import { getPolarClient } from "../../lib/payments"
import {
  type BillingPlan,
  type BillingSubscriptionStatus,
  normalizeBillingSubscriptionStatus,
} from "../../model"
import {
  extractCancelAtPeriodEnd,
  extractCurrentPeriodEnd,
  extractCurrentPeriodStart,
  extractCustomerId,
  extractProductId,
  extractSubscriptionId,
  extractSubscriptionStatus,
  resolvePlanFromProductId,
} from "../polar-payload"
import type { PolarWebhookPayload } from "../types"

export type ExtractedWebhookBillingProjection = {
  plan?: BillingPlan
  subscriptionStatus?: BillingSubscriptionStatus
  polarCustomerId?: string
  polarSubscriptionId?: string
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  cancelAtPeriodEnd?: boolean
}

export function extractWebhookBillingProjection(
  payload: PolarWebhookPayload
): ExtractedWebhookBillingProjection {
  return {
    plan: resolvePlanFromProductId(extractProductId(payload)),
    subscriptionStatus: extractSubscriptionStatus(payload),
    polarCustomerId: extractCustomerId(payload),
    polarSubscriptionId: extractSubscriptionId(payload),
    currentPeriodStart: extractCurrentPeriodStart(payload),
    currentPeriodEnd: extractCurrentPeriodEnd(payload),
    cancelAtPeriodEnd: extractCancelAtPeriodEnd(payload),
  }
}

export async function hydrateBillingProjectionFromSubscription(input: {
  projection: ExtractedWebhookBillingProjection
}): Promise<ExtractedWebhookBillingProjection> {
  const subscriptionId = input.projection.polarSubscriptionId
  if (!subscriptionId) {
    return input.projection
  }

  const hasCoreSubscriptionFields = Boolean(
    input.projection.plan &&
      input.projection.subscriptionStatus &&
      input.projection.currentPeriodStart &&
      input.projection.currentPeriodEnd
  )
  const requiresHydration =
    !hasCoreSubscriptionFields ||
    input.projection.cancelAtPeriodEnd === undefined ||
    !input.projection.polarCustomerId

  if (!requiresHydration) {
    return input.projection
  }

  try {
    const subscription = await getPolarClient().subscriptions.get({
      id: subscriptionId,
    })

    return {
      plan:
        input.projection.plan ??
        resolvePlanFromProductId(subscription.productId),
      subscriptionStatus:
        input.projection.subscriptionStatus ??
        normalizeBillingSubscriptionStatus(subscription.status),
      polarCustomerId:
        input.projection.polarCustomerId ??
        subscription.customerId ??
        undefined,
      polarSubscriptionId:
        subscription.id ?? input.projection.polarSubscriptionId,
      currentPeriodStart:
        input.projection.currentPeriodStart ??
        subscription.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        input.projection.currentPeriodEnd ??
        subscription.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        input.projection.cancelAtPeriodEnd ??
        subscription.cancelAtPeriodEnd ??
        undefined,
    }
  } catch (error) {
    reportNonFatalError(
      "Failed to hydrate billing projection from subscription",
      error
    )
    return input.projection
  }
}
