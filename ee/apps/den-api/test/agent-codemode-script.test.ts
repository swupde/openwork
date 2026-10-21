import { createMockDenAuth } from "./fork-auth-fixture.js"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test"
import { Hono } from "hono"
import { resolveFeatures } from "@openwork/features"
import { MemberTable, OrganizationTable } from "@openwork-ee/den-db/schema"

function seedRequiredEnv() {
  process.env.DEN_APP_MCP_SERVERS_ENABLED = "false"
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.DEN_API_PUBLIC_URL = process.env.DEN_API_PUBLIC_URL ?? "http://127.0.0.1:8790"
}

const userId = createDenTypeId("user")
const organizationId = createDenTypeId("organization")
const memberId = createDenTypeId("member")
let recordedRows: unknown[] = []
let memberActive = true
let auditOrganizationAvailable = true
let workerReads = 0
let registerAgentMcpRoutes: typeof import("../src/mcp/agent.js")["registerAgentMcpRoutes"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function installMocks() {
  mock.module("../src/auth.js", createMockDenAuth)
  const select = () => {
    let table: unknown
    const rows = () => {
      if (table === MemberTable && memberActive) return [{ id: memberId, userId, organizationId, role: "member", removedAt: null }]
      // This free-plan fixture has no audit entitlement; still exercise the real policy lookup.
      if (table === OrganizationTable && auditOrganizationAvailable) return [{ metadata: null }]
      return []
    }
    const query = {
      from: (source: unknown) => { table = source; return query },
      where: () => query,
      innerJoin: () => query,
      leftJoin: () => query,
      orderBy: () => query,
      limit: async () => rows(),
      then: (resolve: (value: ReturnType<typeof rows>) => unknown) => Promise.resolve(rows()).then(resolve),
    }
    return query
  }
  const transactionDb = {
    insert: () => ({
      values: (row: unknown) => {
        recordedRows.push(row)
        return { execute: () => Promise.resolve() }
      },
    }),
    select,
    selectDistinct: select,
  }
  mock.module("../src/db.js", () => ({ db: {
    ...transactionDb,
    transaction: async <T>(run: (tx: typeof transactionDb) => Promise<T>): Promise<T> => run(transactionDb),
  } }))
  mock.module("../src/mcp/auth.js", () => ({ mcpPrincipalCredentialId: () => null, verifyMcpSubscriptionRequest: async () => null,
    getMcpResourceContext: (_request: Request, _route: string, requestId?: string) => ({
      route: "agent",
      resourceUrl: "http://127.0.0.1:8790/mcp/agent",
      metadataUrl: "http://127.0.0.1:8790/.well-known/oauth-protected-resource/mcp/agent",
      oauthResources: ["http://127.0.0.1:8790/mcp/agent"],
      firstPartyResources: [],
      requestId,
    }),
    verifyMcpRequest: () => Promise.resolve({
      userId,
      organizationId,
      scopes: new Set(["mcp:read", "mcp:write"]),
      payload: {},
    }),
  }))
}

function buildApp() {
  const app = new Hono<{ Variables: { requestId: string } }>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req_codemode")
    await next()
  })
  app.get("/openapi.json", (c) => c.json({
    paths: {
      "/v1/workers": {
        get: {
          operationId: "getV1Workers",
          summary: "List workers",
          tags: ["Workers"],
        },
      },
      "/v1/workflows": {
        post: {
          operationId: "saveWorkflow",
          summary: "Save a successful Code Mode run as a Workflow inside an OpenWork Connect Plugin",
          tags: ["Workflows"],
        },
      },
    },
  }))
  app.get("/v1/workers", (c) => {
    workerReads += 1
    return c.json({ workers: [] })
  })
  registerAgentMcpRoutes(app)
  return app
}

async function rpc(app: ReturnType<typeof buildApp>, method: string, params: Record<string, unknown> = {}) {
  const response = await app.request("http://127.0.0.1:8790/mcp/agent", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  expect(response.status).toBe(200)
  const body = await response.text()
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "))
  const payload: unknown = JSON.parse(dataLine?.slice("data: ".length) ?? body)
  if (!isRecord(payload)) throw new Error("Expected JSON-RPC object response")
  return payload
}

function resultRecord(payload: Record<string, unknown>) {
  if (!isRecord(payload.result)) throw new Error("Expected JSON-RPC result")
  return payload.result
}

function errorRecord(payload: Record<string, unknown>) {
  if (!isRecord(payload.error)) throw new Error("Expected JSON-RPC error")
  return payload.error
}

function listedToolNames(payload: Record<string, unknown>): string[] {
  const tools = resultRecord(payload).tools
  if (!Array.isArray(tools)) throw new Error("Expected MCP tools list")
  return tools.flatMap((tool) => isRecord(tool) && typeof tool.name === "string" ? [tool.name] : [])
}

function firstText(payload: Record<string, unknown>): string {
  const content = resultRecord(payload).content
  if (!Array.isArray(content)) throw new Error("Expected MCP tool content")
  const text = content.find((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
  if (!isRecord(text) || typeof text.text !== "string") throw new Error("Expected text tool result")
  return text.text
}

beforeAll(async () => {
  seedRequiredEnv()
  installMocks()
  const orgs = await import("../src/orgs.js")
  mock.module("../src/orgs.js", () => ({
    ...orgs,
    listTeamsForMember: async () => [],
    getOrganizationContextForUser: async () => {
      const now = new Date()
      return {
        organization: { id: organizationId, name: "Code Mode fixture", slug: organizationId, logo: null,
          allowedEmailDomains: null, metadata: null, createdAt: now, updatedAt: now },
        currentMember: { id: memberId, userId, role: "member", directRole: "member", adminTeams: [],
          createdAt: now, joinedAt: now, isOwner: false },
        invitations: [], members: [], roles: [], teams: [],
        features: resolveFeatures({ deployment: "self_hosted", locks: {}, rollouts: {}, overrides: {} }),
      }
    },
  }))
  registerAgentMcpRoutes = (await import("../src/mcp/agent.js")).registerAgentMcpRoutes
}, 30_000)

beforeEach(() => {
  recordedRows = []
  memberActive = true
  auditOrganizationAvailable = true
  workerReads = 0
})

afterAll(() => {
  mock.restore()
})

test("registers execute_capability_script without any org rollout flag", async () => {
  const tools = listedToolNames(await rpc(buildApp(), "tools/list"))
  expect(tools).toContain("execute_capability_script")
  expect(tools).not.toContain("save_artifact_view")
  expect(tools).not.toContain("activate_artifact_view_revision")
  expect(tools).not.toContain("retire_artifact_view")
})

test("registers Code Mode without enabling agent-authored MCP App views", async () => {
  const names = listedToolNames(await rpc(buildApp(), "tools/list"))
  expect(names).toContain("execute_capability_script")
  expect(names).toContain("render_workflow_artifact")
  expect(names).not.toContain("render_dynamic_artifact")
  expect(names).not.toContain("save_artifact_view")
  expect(names).not.toContain("activate_artifact_view_revision")
  expect(names).not.toContain("retire_artifact_view")
  expect(names.filter((name) => /^(search|select|clear)_programs?$|^(run|render)_selected_program$/.test(name))).toEqual([])
})

test("rejects guessed generated-view tool calls while keeping Workflows enabled", async () => {
  for (const name of ["save_artifact_view", "activate_artifact_view_revision", "retire_artifact_view"]) {
    const payload = await rpc(buildApp(), "tools/call", { name, arguments: {} })
    expect(errorRecord(payload)).toMatchObject({ code: -32602, message: expect.stringContaining("not found") })
  }
})

test("advertises standard Workflow discovery and execution instructions", async () => {
  const app = buildApp()
  const initialized = resultRecord(await rpc(app, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "agent-codemode-test", version: "1.0.0" },
  }))
  const uri = "openwork://agent/guidance.md"
  expect(initialized.instructions).toContain(`Read ${uri} with resources/read`)
  const resource = resultRecord(await rpc(app, "resources/read", { uri }))
  if (!Array.isArray(resource.contents)) throw new Error("Missing guidance resource contents")
  const guidance = resource.contents.find((item) => isRecord(item) && item.uri === uri)
  if (!isRecord(guidance) || typeof guidance.text !== "string") throw new Error("Missing guidance text")
  expect(guidance.mimeType).toBe("text/markdown")
  expect(guidance.text).toContain("Workflows are saved procedures discovered through search_capabilities")
  expect(guidance.text).toContain("Use execute_capability only with exact names returned by search_capabilities")
  expect(guidance.text).toContain("For an app, dashboard, or artifact view of Workflow results")
  expect(guidance.text).toContain("Builder tools and other direct MCP tools are outside capability search; call them directly")
  expect(guidance.text).not.toContain("Always call search_capabilities first")
  expect(guidance.text).toContain("Workflow runs produce artifacts rendered by render_workflow_artifact")
  expect(guidance.text).not.toContain("search/selection tools")
})

test("executes a confined script by default", async () => {
  const payload = await rpc(buildApp(), "tools/call", {
    name: "execute_capability_script",
    arguments: { code: "return 1 + 1" },
  })
  expect(firstText(payload)).toBe("2")
})

test("denies authoring after the caller's organization membership is removed", async () => {
  memberActive = false
  const payload = await rpc(buildApp(), "tools/call", {
    name: "execute_capability_script", arguments: { code: "return 2" },
  })
  expect(resultRecord(payload).isError).toBe(true)
  expect(JSON.parse(firstText(payload))).toMatchObject({ error: "membership_required" })
  expect(recordedRows).toEqual([])
})

test("refuses authoring when audit availability cannot be verified", async () => {
  auditOrganizationAvailable = false
  const payload = await rpc(buildApp(), "tools/call", {
    name: "execute_capability_script", arguments: { code: "return await tools.den.getWorkers({})" },
  })
  expect(resultRecord(payload).isError).toBe(true)
  expect(JSON.parse(firstText(payload))).toMatchObject({ error: "audit_unavailable" })
  expect(recordedRows).toEqual([])
  expect(workerReads).toBe(0)
})

test("default App-server authoring keeps the live write restriction", async () => {
  const { env } = await import("../src/env.js")
  const previous = env.appMcpServersEnabled
  env.appMcpServersEnabled = true
  try {
    const names = listedToolNames(await rpc(buildApp(), "tools/list"))
    expect(names).toContain("prepare_app")
    expect(names).toContain("create_app")
    const payload = await rpc(buildApp(), "tools/call", {
      name: "execute_capability_script",
      arguments: {
        mode: "live",
        code: 'try { await tools.den.saveWorkflow({ body: {} }); return "write executed" } catch { return "write denied" }',
      },
    })
    expect(firstText(payload)).toBe("write denied")
    expect(recordedRows).toHaveLength(1)
    expect(recordedRows.every((row) => isRecord(row) && row.source === "authoring:live")).toBe(true)
  } finally {
    env.appMcpServersEnabled = previous
  }
})

test("normalizes JSON-encoded script input", async () => {
  const payload = await rpc(buildApp(), "tools/call", {
    name: "execute_capability_script",
    arguments: {
      code: "return { t: typeof input, v: input.channel }",
      input: "{\"channel\":\"bug\"}",
    },
  })
  expect(JSON.parse(firstText(payload))).toEqual({ t: "object", v: "bug" })
})

test("keeps object script input unchanged", async () => {
  const payload = await rpc(buildApp(), "tools/call", {
    name: "execute_capability_script",
    arguments: {
      code: "return { t: typeof input, v: input.channel }",
      input: { channel: "bug" },
    },
  })
  expect(JSON.parse(firstText(payload))).toEqual({ t: "object", v: "bug" })
})

test("exposes in-program capability search over the Den namespace", async () => {
  const payload = await rpc(buildApp(), "tools/call", {
    name: "execute_capability_script",
    arguments: { code: "return await tools.$codemode.search({ query: \"workers\" })" },
  })
  expect(firstText(payload)).toContain("tools.den.getWorkers")
})

test("makes the Workflow save operation discoverable through the standard capability catalog", async () => {
  const payload = await rpc(buildApp(), "tools/call", {
    name: "search_capabilities",
    arguments: { query: "save Workflow to Plugin" },
  })
  expect(firstText(payload)).toContain("saveWorkflow")
})

test("advertises authoring modes, contracts and exact discovered invocation guidance", async () => {
  const tools = resultRecord(await rpc(buildApp(), "tools/list")).tools
  if (!Array.isArray(tools)) throw new Error("Missing tools")
  const tool = tools.find((item) => isRecord(item) && item.name === "execute_capability_script")
  if (!isRecord(tool) || !isRecord(tool.inputSchema) || !isRecord(tool.inputSchema.properties)) throw new Error("Missing input schema")
  expect(Object.keys(tool.inputSchema.properties)).toEqual(["code", "mode", "input", "timeZone", "inputSchema", "outputSchema"])
  expect(tool.description).toContain("exact scriptPath")
  expect(tool.description).toContain("wrapped in query")
  expect(tool.description).toContain("outputSchema")
})

test("returns receipt metadata without changing legacy text or persisting raw artifact data", async () => {
  const payload = await rpc(buildApp(), "tools/call", {
    name: "execute_capability_script",
    arguments: { code: "return input", input: { privateValue: "private-test-value" }, outputSchema: { type: "object" } },
  })
  expect(JSON.parse(firstText(payload))).toEqual({ privateValue: "private-test-value" })
  const result = resultRecord(payload)
  if (!isRecord(result.structuredContent)) throw new Error("Missing structured content")
  expect(result.structuredContent).toMatchObject({
    value: { privateValue: "private-test-value" },
    metadata: { receiptId: expect.any(String), mode: "adhoc", executionType: "authoring-test", verification: "schema",
      executedAt: expect.any(String), fetchedAt: expect.any(String),
      retention: { available: true, canSaveByReceipt: true, scope: "process", ttlMs: 900_000 } },
  })
  expect(result.content).toHaveLength(2)
  const receipt = recordedRows.find((row) => isRecord(row) && row.source === "adhoc")
  expect(receipt).toMatchObject({ status: "succeeded", script_input: null, script_input_digest: expect.stringMatching(/^sha256:/),
    output_schema_digest: expect.stringMatching(/^sha256:/), result_markdown: null, renderer_version: null })
  expect(JSON.stringify(receipt)).not.toContain("private-test-value")
})

test("MCP live mode exposes only generated runtime with UTC default", async () => {
  const payload = await rpc(buildApp(), "tools/call", {
    name: "execute_capability_script", arguments: { mode: "live", code: "return input" },
  })
  const value: unknown = JSON.parse(firstText(payload))
  if (!isRecord(value) || !isRecord(value.runtime)) throw new Error("Missing runtime")
  expect(Object.keys(value)).toEqual(["runtime"])
  expect(Object.keys(value.runtime).sort()).toEqual(["dayEnd", "dayStart", "now", "timeZone", "today"])
  expect(value.runtime.timeZone).toBe("UTC")
  expect(recordedRows.some((row) => isRecord(row) && row.source === "authoring:live")).toBe(true)
})

test("MCP rejects forged live input, invalid time zones, and invalid contracts", async () => {
  for (const args of [
    { mode: "live", input: null }, { mode: "live", input: { runtime: { today: "forged" } } },
    { mode: "live", timeZone: "Not/A_Zone" }, { timeZone: "UTC" },
    { inputSchema: { type: "string" } }, { outputSchema: { type: "string" } },
  ]) {
    const payload = await rpc(buildApp(), "tools/call", {
      name: "execute_capability_script", arguments: { code: "return 2", ...args },
    })
    expect(resultRecord(payload).isError).toBe(true)
  }
})
