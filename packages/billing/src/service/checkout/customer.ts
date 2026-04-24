import { db } from "@crikket/db"
import { user } from "@crikket/db/schema/auth"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"
import { getPolarClient } from "../../lib/payments"
import { findPaginatedPolarItems } from "../polar-pagination"
import { isPolarResourceNotFoundError } from "../utils"
import { isPolarCustomerEmailAlreadyExistsError } from "./shared"
import type { BillingUserProfile, PolarCustomer } from "./types"

async function findPolarCustomerByEmail(
  email: string
): Promise<PolarCustomer | null> {
  const normalizedEmail = email.toLowerCase()
  const { exactMatch, firstItem } = await findPaginatedPolarItems({
    fetchPage: (page, limit) =>
      getPolarClient().customers.list({
        email,
        limit,
        page,
      }),
    matches: (customer) => customer.email.toLowerCase() === normalizedEmail,
  })

  return exactMatch ?? firstItem
}

function normalizeDisplayName(name: string): string | null {
  const normalized = name.trim()
  return normalized.length > 0 ? normalized : null
}

async function getBillingUserProfile(
  userId: string
): Promise<BillingUserProfile> {
  const billingUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      email: true,
      name: true,
    },
  })

  if (!billingUser) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Unable to resolve billing user for checkout.",
    })
  }

  return {
    email: billingUser.email,
    name: billingUser.name,
  }
}

async function getOrCreatePolarCustomerForUser(input: {
  userId: string
  userEmail: string
  userName: string | null
}): Promise<PolarCustomer> {
  try {
    return await getPolarClient().customers.getExternal({
      externalId: input.userId,
    })
  } catch (error) {
    if (!isPolarResourceNotFoundError(error)) {
      throw error
    }
  }

  try {
    return await getPolarClient().customers.create({
      externalId: input.userId,
      email: input.userEmail,
      name: input.userName,
    })
  } catch (error) {
    if (!isPolarCustomerEmailAlreadyExistsError(error)) {
      throw error
    }

    const existingCustomer = await findPolarCustomerByEmail(input.userEmail)
    if (!existingCustomer) {
      throw error
    }

    return existingCustomer
  }
}

async function syncPolarCustomerProfile(input: {
  customer: PolarCustomer
  userEmail: string
  userName: string | null
}): Promise<PolarCustomer> {
  const shouldSyncCustomerProfile =
    input.customer.email !== input.userEmail ||
    (input.customer.name ?? null) !== input.userName
  if (!shouldSyncCustomerProfile) {
    return input.customer
  }

  try {
    return await getPolarClient().customers.update({
      id: input.customer.id,
      customerUpdate: {
        email: input.userEmail,
        name: input.userName,
      },
    })
  } catch (error) {
    reportNonFatalError(
      "Failed to sync Polar customer profile before checkout",
      error
    )
    return input.customer
  }
}

export async function resolvePolarCustomerForUser(
  userId: string
): Promise<{ customer: PolarCustomer; userEmail: string; userName: string }> {
  const billingUser = await getBillingUserProfile(userId)
  const userName = normalizeDisplayName(billingUser.name)

  const customer = await getOrCreatePolarCustomerForUser({
    userId,
    userEmail: billingUser.email,
    userName,
  })
  const syncedCustomer = await syncPolarCustomerProfile({
    customer,
    userEmail: billingUser.email,
    userName,
  })

  return {
    customer: syncedCustomer,
    userEmail: billingUser.email,
    userName: userName ?? "",
  }
}
