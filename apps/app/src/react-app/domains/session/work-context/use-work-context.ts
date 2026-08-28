import { useCallback, useEffect, useState } from "react"
import {
  DEFAULT_WORK_CONTEXT,
  type WorkContext,
} from "@openwork/types/work-context"

import type { OpenworkServerClient } from "@/app/lib/openwork-server"
import { loadWorkContextWithStartupRetry } from "./load-work-context"

export function useWorkContext(client: OpenworkServerClient | null, workspaceId: string | null) {
  const [context, setContext] = useState<WorkContext>(DEFAULT_WORK_CONTEXT)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!client || !workspaceId) {
      setContext(DEFAULT_WORK_CONTEXT)
      setLoading(false)
      setError(null)
      return () => { active = false }
    }
    setLoading(true)
    setError(null)
    void loadWorkContextWithStartupRetry({
      load: () => client.getWorkContext(workspaceId),
    }).then((next) => {
      if (active) setContext(next)
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Work context could not be loaded.")
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [client, workspaceId])

  const update = useCallback(async (next: WorkContext) => {
    if (!client || !workspaceId) throw new Error("Workspace work context is unavailable.")
    setSaving(true)
    setError(null)
    try {
      const persisted = await client.updateWorkContext(workspaceId, next)
      setContext(persisted)
      return persisted
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Work context could not be saved."
      setError(message)
      throw cause
    } finally {
      setSaving(false)
    }
  }, [client, workspaceId])

  return { context, loading, saving, error, update }
}
