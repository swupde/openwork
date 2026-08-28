import type { WorkContext } from "@openwork/types/work-context"

import { OpenworkServerError } from "@/app/lib/openwork-server"

const STARTUP_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const

export async function loadWorkContextWithStartupRetry(input: {
  load: () => Promise<WorkContext>
  retryDelaysMs?: readonly number[]
  wait?: (delayMs: number) => Promise<void>
}): Promise<WorkContext> {
  const retryDelaysMs = input.retryDelaysMs ?? STARTUP_RETRY_DELAYS_MS
  const wait = input.wait ?? ((delayMs) => new Promise<void>((resolve) => window.setTimeout(resolve, delayMs)))

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await input.load()
    } catch (cause) {
      const delayMs = retryDelaysMs[attempt]
      if (cause instanceof OpenworkServerError || delayMs === undefined) throw cause
      await wait(delayMs)
    }
  }
}
