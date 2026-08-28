import {
  DEFAULT_WORK_CONTEXT,
  type WorkContext,
  workContextSchema,
} from "@openwork/types/work-context"

import type { ServerConfig } from "./types.js"
import { createWorkspaceKvStore } from "./workspace-kv-store.js"

const workContextStore = createWorkspaceKvStore<WorkContext>({
  tableName: "workspace_work_context",
  valueColumn: "context_json",
  parse: (json) => workContextSchema.parse(JSON.parse(json)),
  serialize: (value) => JSON.stringify(workContextSchema.parse(value)),
})

export async function getWorkspaceWorkContext(config: ServerConfig, workspaceId: string): Promise<WorkContext> {
  return await workContextStore.get(config, workspaceId) ?? DEFAULT_WORK_CONTEXT
}

export async function setWorkspaceWorkContext(config: ServerConfig, workspaceId: string, value: WorkContext): Promise<void> {
  await workContextStore.set(config, workspaceId, workContextSchema.parse(value))
}
