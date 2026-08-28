import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startServer } from "./server.js"
import type { ServerConfig } from "./types.js"

const roots: string[] = []
const stops: Array<() => void> = []

afterEach(async () => {
  while (stops.length) stops.pop()?.()
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("workspace work context routes", () => {
  test("defaults, persists valid context, and rejects unknown values", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-work-context-route-"))
    const workspace = join(root, "workspace")
    await mkdir(workspace, { recursive: true })
    roots.push(root)
    const config: ServerConfig = {
      host: "127.0.0.1",
      port: 0,
      token: "client-token",
      hostToken: "host-token",
      approval: { mode: "auto", timeoutMs: 1_000 },
      corsOrigins: ["*"],
      workspaces: [{ id: "ws_1", name: "Workspace", path: workspace, preset: "starter", workspaceType: "local" }],
      authorizedRoots: [workspace],
      readOnly: false,
      startedAt: Date.now(),
      tokenSource: "cli",
      hostTokenSource: "cli",
      logFormat: "pretty",
      logRequests: false,
      configPath: join(root, "server.json"),
    }
    const server = await startServer(config)
    stops.push(() => server.stop())
    const base = `http://127.0.0.1:${server.port}`
    const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json" }

    const initial = await fetch(`${base}/workspace/ws_1/work-context`, { headers })
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({ dataContext: "internal", workMode: "everyday" })

    const update = await fetch(`${base}/workspace/ws_1/work-context`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ dataContext: "client", workMode: "documents-spreadsheets" }),
    })
    expect(update.status).toBe(200)
    expect(await update.json()).toEqual({ dataContext: "client", workMode: "documents-spreadsheets" })

    const invalid = await fetch(`${base}/workspace/ws_1/work-context`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ dataContext: "client", workMode: "future", model: "hidden" }),
    })
    expect(invalid.status).toBe(400)

    const retained = await fetch(`${base}/workspace/ws_1/work-context`, { headers })
    expect(await retained.json()).toEqual({ dataContext: "client", workMode: "documents-spreadsheets" })
  })
})
