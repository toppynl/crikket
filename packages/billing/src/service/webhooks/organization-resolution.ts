import { db } from "@crikket/db"
import { organizationBillingAccount } from "@crikket/db/schema/billing"
import { eq } from "drizzle-orm"

import { getPolarClient } from "../../lib/payments"
import {
  extractCheckoutId,
  extractCustomerId,
  extractReferenceId,
  extractReferenceIdFromMetadata,
  extractSubscriptionId,
} from "../polar-payload"
import type { PolarWebhookPayload } from "../types"
import {
  findFirstStringByKeys,
  getErrorMessage,
  isPolarResourceNotFoundError,
} from "../utils"

type OrganizationLookupResult = {
  organizationId?: string
  lookupError?: Error
}

async function resolveOrganizationIdFromSubscriptionPayload(
  payload: PolarWebhookPayload
): Promise<OrganizationLookupResult> {
  const subscriptionId = extractSubscriptionId(payload)
  if (!subscriptionId) {
    return {}
  }

  const billingAccountBySubscription =
    await db.query.organizationBillingAccount.findFirst({
      where: eq(organizationBillingAccount.polarSubscriptionId, subscriptionId),
      columns: {
        organizationId: true,
      },
    })
  if (billingAccountBySubscription?.organizationId) {
    return { organizationId: billingAccountBySubscription.organizationId }
  }

  try {
    const subscription = await getPolarClient().subscriptions.get({
      id: subscriptionId,
    })
    const subscriptionReferenceId =
      extractReferenceIdFromMetadata(subscription.metadata) ??
      findFirstStringByKeys(subscription, ["referenceId", "reference_id"])
    if (subscriptionReferenceId) {
      return { organizationId: subscriptionReferenceId }
    }
  } catch (error) {
    if (isPolarResourceNotFoundError(error)) {
      return {}
    }

    return {
      lookupError: new Error(
        `Failed to resolve subscription ${subscriptionId}: ${getErrorMessage(
          error,
          "Unknown subscription lookup error"
        )}`
      ),
    }
  }

  return {}
}

async function resolveOrganizationIdFromCheckoutPayload(
  payload: PolarWebhookPayload
): Promise<OrganizationLookupResult> {
  const checkoutId = extractCheckoutId(payload)
  if (!checkoutId) {
    return {}
  }

  try {
    const checkout = await getPolarClient().checkouts.get({
      id: checkoutId,
    })
    const checkoutReferenceId =
      extractReferenceIdFromMetadata(checkout.metadata) ??
      findFirstStringByKeys(checkout, ["referenceId", "reference_id"])
    if (checkoutReferenceId) {
      return { organizationId: checkoutReferenceId }
    }
  } catch (error) {
    return {
      lookupError: new Error(
        `Failed to resolve checkout ${checkoutId}: ${getErrorMessage(
          error,
          "Unknown checkout lookup error"
        )}`
      ),
    }
  }

  return {}
}

async function resolveOrganizationIdFromCustomerId(
  customerId: string
): Promise<string | undefined> {
  const billingAccountsByCustomer = await db
    .select({
      organizationId: organizationBillingAccount.organizationId,
    })
    .from(organizationBillingAccount)
    .where(eq(organizationBillingAccount.polarCustomerId, customerId))
    .limit(2)

  if (billingAccountsByCustomer.length === 1) {
    return billingAccountsByCustomer[0]?.organizationId
  }

  return undefined
}

export async function resolveOrganizationIdFromWebhookPayload(
  payload: PolarWebhookPayload
): Promise<string | undefined> {
  const referenceId = extractReferenceId(payload)
  if (referenceId) {
    return referenceId
  }

  const subscriptionLookup =
    await resolveOrganizationIdFromSubscriptionPayload(payload)
  if (subscriptionLookup.organizationId) {
    return subscriptionLookup.organizationId
  }

  const checkoutLookup = await resolveOrganizationIdFromCheckoutPayload(payload)
  if (checkoutLookup.organizationId) {
    return checkoutLookup.organizationId
  }

  const customerId = extractCustomerId(payload)
  if (!customerId) {
    if (subscriptionLookup.lookupError) {
      throw subscriptionLookup.lookupError
    }

    if (checkoutLookup.lookupError) {
      throw checkoutLookup.lookupError
    }

    return undefined
  }

  const customerLookupOrganizationId =
    await resolveOrganizationIdFromCustomerId(customerId)
  if (customerLookupOrganizationId) {
    return customerLookupOrganizationId
  }

  if (subscriptionLookup.lookupError) {
    throw subscriptionLookup.lookupError
  }

  if (checkoutLookup.lookupError) {
    throw checkoutLookup.lookupError
  }

  return undefined
}
