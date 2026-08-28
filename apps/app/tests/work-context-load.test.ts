import { describe, expect, test } from "bun:test"

import { OpenworkServerError } from "../src/app/lib/openwork-server"
import { loadWorkContextWithStartupRetry } from "../src/react-app/domains/session/work-context/load-work-context"

describe("work-context startup loading", () => {
  test("retries a transient local-server transport failure and returns persisted state", async () => {
    let attempts = 0
    const waits: number[] = []

    const result = await loadWorkContextWithStartupRetry({
      load: async () => {
        attempts += 1
        if (attempts < 3) throw new TypeError("Failed to fetch")
        return { dataContext: "client", workMode: "documents-spreadsheets" }
      },
      retryDelaysMs: [10, 20, 30],
      wait: async (delayMs) => { waits.push(delayMs) },
    })

    expect(result).toEqual({ dataContext: "client", workMode: "documents-spreadsheets" })
    expect(attempts).toBe(3)
    expect(waits).toEqual([10, 20])
  })

  test("does not retry an authoritative HTTP response", async () => {
    let attempts = 0
    const error = new OpenworkServerError(403, "forbidden", "Forbidden")

    await expect(loadWorkContextWithStartupRetry({
      load: async () => {
        attempts += 1
        throw error
      },
      retryDelaysMs: [10, 20],
      wait: async () => undefined,
    })).rejects.toBe(error)

    expect(attempts).toBe(1)
  })
})
