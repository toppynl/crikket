import { db } from "@crikket/db"
import { organizationBillingAccount } from "@crikket/db/schema/billing"
import { env } from "@crikket/env/server"
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
import { getErrorMessage } from "../utils"
import { findWebhookBillingBackfill } from "../webhooks/backfill"
import { assertPaymentsEnabled } from "./shared"
import { findUpdatableSubscription } from "./subscription-discovery"
import type {
  OrganizationBillingAccountSnapshot,
  PortalResolutionState,
} from "./types"
import { isSubscriptionBoundToOrganization } from "./types"

async function createPortalSessionByExternalCustomerIds(input: {
  externalCustomerIds: string[]
  returnUrl?: string
}): Promise<{ url: string | null; failures: string[] }> {
  const failures: string[] = []

  for (const externalCustomerId of input.externalCustomerIds) {
    try {
      const customerSession = await getPolarClient().customerSessions.create({
        externalCustomerId,
        returnUrl: input.returnUrl,
      })

      return { url: customerSession.customerPortalUrl, failures }
    } catch (error) {
      failures.push(
        `external customer portal lookup failed for ${externalCustomerId} (${getErrorMessage(error, "unknown error")})`
      )
    }
  }

  return { url: null, failures }
}

function createPortalResolutionState(input: {
  billingAccount: OrganizationBillingAccountSnapshot | null
}): PortalResolutionState {
  return {
    customerId: input.billingAccount?.polarCustomerId ?? null,
    subscriptionId: input.billingAccount?.polarSubscriptionId ?? null,
    recoveryFailures: [],
  }
}

async function recoverPortalStateFromWebhookBackfill(input: {
  organizationId: string
  state: PortalResolutionState
}): Promise<void> {
  if (input.state.customerId && input.state.subscriptionId) {
    return
  }

  const webhookBackfill = await findWebhookBillingBackfill(input.organizationId)
  if (!webhookBackfill) {
    return
  }

  input.state.customerId =
    input.state.customerId ?? webhookBackfill.polarCustomerId ?? null
  input.state.subscriptionId =
    input.state.subscriptionId ?? webhookBackfill.polarSubscriptionId ?? null

  await upsertOrganizationBillingProjection({
    organizationId: input.organizationId,
    plan: webhookBackfill.plan,
    subscriptionStatus: webhookBackfill.subscriptionStatus,
    polarCustomerId: webhookBackfill.polarCustomerId,
    polarSubscriptionId: webhookBackfill.polarSubscriptionId,
    currentPeriodStart: webhookBackfill.currentPeriodStart,
    currentPeriodEnd: webhookBackfill.currentPeriodEnd,
    cancelAtPeriodEnd: webhookBackfill.cancelAtPeriodEnd,
    source: "portal-recovery",
  })
}

async function recoverPortalStateFromStoredSubscription(input: {
  organizationId: string
  state: PortalResolutionState
}): Promise<void> {
  if (!input.state.subscriptionId) {
    return
  }

  try {
    const subscription = await getPolarClient().subscriptions.get({
      id: input.state.subscriptionId,
    })

    if (isSubscriptionBoundToOrganization(subscription, input.organizationId)) {
      input.state.customerId = subscription.customerId ?? input.state.customerId
      return
    }

    input.state.subscriptionId = null
    input.state.customerId = null
    input.state.recoveryFailures.push(
      "stored subscription is not scoped to the active organization"
    )
  } catch (error) {
    input.state.recoveryFailures.push(
      `subscription lookup failed (${getErrorMessage(error, "unknown error")})`
    )
  }
}

async function recoverPortalStateFromOrganizationSubscription(input: {
  organizationId: string
  billingAccount: OrganizationBillingAccountSnapshot | null
  state: PortalResolutionState
}): Promise<void> {
  if (input.state.customerId && input.state.subscriptionId) {
    return
  }

  const organizationSubscription = await findUpdatableSubscription({
    organizationId: input.organizationId,
    billingAccount: input.billingAccount,
  }).catch((error) => {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: getErrorMessage(
        error,
        "Failed to resolve organization subscription"
      ),
    })
  })

  if (!organizationSubscription) {
    return
  }

  const resolvedPlan = normalizeBillingPlan(
    resolvePlanFromProductId(organizationSubscription.productId)
  )
  const resolvedStatus = normalizeBillingSubscriptionStatus(
    organizationSubscription.status
  )

  input.state.customerId = organizationSubscription.customerId
  input.state.subscriptionId = organizationSubscription.id

  await upsertOrganizationBillingProjection({
    organizationId: input.organizationId,
    plan: resolvedPlan,
    subscriptionStatus: resolvedStatus,
    polarCustomerId: organizationSubscription.customerId ?? undefined,
    polarSubscriptionId: organizationSubscription.id,
    currentPeriodStart: organizationSubscription.currentPeriodStart,
    currentPeriodEnd: organizationSubscription.currentPeriodEnd ?? undefined,
    cancelAtPeriodEnd: organizationSubscription.cancelAtPeriodEnd,
    source: "portal-recovery",
  })
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
      polarSubscriptionId: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  })

  const portalState = createPortalResolutionState({
    billingAccount: billingAccount ?? null,
  })

  await recoverPortalStateFromWebhookBackfill({
    organizationId: input.organizationId,
    state: portalState,
  })
  await recoverPortalStateFromStoredSubscription({
    organizationId: input.organizationId,
    state: portalState,
  })
  await recoverPortalStateFromOrganizationSubscription({
    organizationId: input.organizationId,
    billingAccount: billingAccount ?? null,
    state: portalState,
  })

  if (!portalState.customerId) {
    const externalLookup = await createPortalSessionByExternalCustomerIds({
      externalCustomerIds: [input.organizationId],
      returnUrl: env.POLAR_SUCCESS_URL ?? undefined,
    })
    portalState.recoveryFailures.push(...externalLookup.failures)
    if (externalLookup.url) {
      return { url: externalLookup.url }
    }
  }

  if (!portalState.customerId) {
    const recoveryHint =
      portalState.recoveryFailures.length > 0
        ? ` Recovery attempts failed (${portalState.recoveryFailures.join("; ")}).`
        : ""
    throw new ORPCError("BAD_REQUEST", {
      message: `No billing customer found for this organization. Start a Pro or Studio checkout first.${recoveryHint}`,
    })
  }

  try {
    const customerSession = await getPolarClient().customerSessions.create({
      customerId: portalState.customerId,
      returnUrl: env.POLAR_SUCCESS_URL ?? undefined,
    })

    return { url: customerSession.customerPortalUrl }
  } catch (error) {
    const message = getErrorMessage(
      error,
      "Failed to create customer portal session"
    )

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}
