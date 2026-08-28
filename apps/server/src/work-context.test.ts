import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DEFAULT_WORK_CONTEXT } from "@openwork/types/work-context"
import type { ServerConfig } from "./types.js"
import { getWorkspaceWorkContext, setWorkspaceWorkContext } from "./work-context.js"

const roots: string[] = []

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

async function setup(): Promise<ServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "openwork-work-context-"))
  roots.push(root)
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 1_000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
    configPath: join(root, "server.json"),
  }
}

describe("workspace work context store", () => {
  test("defaults without materializing state and persists exactly two fields", async () => {
    const config = await setup()
    expect(await getWorkspaceWorkContext(config, "ws_1")).toEqual(DEFAULT_WORK_CONTEXT)

    await setWorkspaceWorkContext(config, "ws_1", {
      dataContext: "client",
      workMode: "documents-spreadsheets",
    })
    expect(await getWorkspaceWorkContext(config, "ws_1")).toEqual({
      dataContext: "client",
      workMode: "documents-spreadsheets",
    })
  })
})
