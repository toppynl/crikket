import { env } from "@crikket/env/server"
import { ORPCError } from "@orpc/server"
import { getPolarClient } from "../../lib/payments"
import { assertUserCanManageOrganizationBilling } from "../access"
import { getErrorMessage } from "../utils"
import { resolvePolarCustomerForUser } from "./customer"
import { assertPaymentsEnabled, resolveProductIdByPlan } from "./shared"
import type { BillingInterval } from "./types"

export async function createOrganizationCheckoutSession(input: {
  organizationId: string
  plan: "pro" | "studio"
  billingInterval?: BillingInterval
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

  const billingInterval = input.billingInterval ?? "monthly"
  const productId = resolveProductIdByPlan({
    plan: input.plan,
    billingInterval,
  })

  try {
    const { customer, userEmail, userName } = await resolvePolarCustomerForUser(
      input.userId
    )

    const checkout = await getPolarClient().checkouts.create({
      customerEmail: userEmail,
      customerId: customer.id,
      customerName: userName.length > 0 ? userName : null,
      products: [productId],
      successUrl: env.POLAR_SUCCESS_URL,
      metadata: {
        billingInterval,
        initiatedByUserId: input.userId,
        plan: input.plan,
        referenceId: input.organizationId,
        source: "crikket-billing-checkout",
      },
    })

    return { url: checkout.url }
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create checkout session")

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}
