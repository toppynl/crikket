import { beforeAll, describe, expect, it } from "bun:test"
import { ensureBillingTestEnv } from "./utils/env"

ensureBillingTestEnv()

let extractProviderEventId: typeof import("../src/service/polar-payload").extractProviderEventId

beforeAll(async () => {
  ;({ extractProviderEventId } = await import("../src/service/polar-payload"))
})

describe("extractProviderEventId flow", () => {
  it("uses provider event id when present", async () => {
    const providerEventId = await extractProviderEventId(
      {
        id: "evt_123",
        type: "subscription.updated",
      },
      "subscription.updated"
    )

    expect(providerEventId).toBe("polar:event:evt_123")
  })

  it("builds deterministic fallback ids when provider event id is missing", async () => {
    const payload = {
      type: "subscription.updated",
      data: {
        subscriptionId: "sub_123",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    }

    const first = await extractProviderEventId(payload, "subscription.updated")
    const second = await extractProviderEventId(payload, "subscription.updated")

    expect(first).toBe(second)
    expect(
      first.startsWith("polar:fallback:subscription.updated:sub_123:")
    ).toBe(true)
  })

  it("keeps fallback id stable when payload keys are reordered", async () => {
    const payloadA = {
      type: "subscription.updated",
      data: {
        subscriptionId: "sub_123",
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: {
          referenceId: "org_1",
          source: "polar",
        },
      },
    }
    const payloadB = {
      data: {
        metadata: {
          source: "polar",
          referenceId: "org_1",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        subscriptionId: "sub_123",
      },
      type: "subscription.updated",
    }

    const first = await extractProviderEventId(payloadA, "subscription.updated")
    const second = await extractProviderEventId(
      payloadB,
      "subscription.updated"
    )

    expect(first).toBe(second)
  })
})
