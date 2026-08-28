import { expect } from "vitest";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { denFetch, evalIn } from "@openwork/behaviors";
import { startMockGoogle } from "@openwork/labs";
import { app, localMysqlIsRunning, needs, server, test } from "@openwork/testkit";
import type { DenSession } from "@openwork/behaviors";
import type { MockGoogleHandle } from "@openwork/labs";

const localPlacement = process.env.OPENWORK_EVAL_DAYTONA !== "1"
  && !process.env.OPENWORK_EVAL_DEN_API_URL?.trim();
const mysqlOpen = await localMysqlIsRunning();
const title = !localPlacement
  ? "native document lifecycle skipped — needs local placement without OPENWORK_EVAL_DEN_API_URL"
  : !mysqlOpen
    ? "native document lifecycle skipped — needs MySQL on 127.0.0.1:3306"
    : "drafted content publishes and updates as native Google Docs, Sheets, and Slides";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} was missing.`);
  return value;
}

function auth(session: DenSession): Record<string, string> {
  return { authorization: `Bearer ${session.token}` };
}

function googleEnvironment(google: MockGoogleHandle): Record<string, string> {
  return {
    DEN_GOOGLE_API_BASE_URL: google.apiUrl,
    DEN_GOOGLE_OAUTH_AUTHORIZE_URL: google.authorizeUrl,
    DEN_GOOGLE_OAUTH_TOKEN_URL: google.tokenUrl,
    DEN_GOOGLE_OAUTH_USERINFO_URL: google.userinfoUrl,
  };
}

function installEnvironment(values: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

async function connectGoogle(session: DenSession, google: MockGoogleHandle, email: string): Promise<void> {
  const configured = await denFetch(session, "/v1/oauth-providers/google-workspace/client", {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify({
      clientId: "native-files-spec-client",
      clientSecret: "native-files-spec-secret",
      features: ["driveFile"],
    }),
  });
  expect(configured.response.status).toBe(200);
  const started = await denFetch(session, "/v1/oauth-providers/google-workspace/connect/start", {
    headers: auth(session),
  });
  const authorizeUrl = isRecord(started.body) ? stringValue(started.body.authorizeUrl, "authorize URL") : "";
  expect(started.response.status).toBe(200);
  expect((await fetch(authorizeUrl, { redirect: "manual" })).status).toBe(200);
  await google.chooseAccount(email, { timeoutMs: 10_000 });
}

async function nativeRequest(
  apiUrl: string,
  session: DenSession,
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...auth(session), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Native file request failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload;
}

test.skipIf(!localPlacement || !mysqlOpen)("uploads and generated artifacts stay in app-managed execution storage", async ({ evidence, place }) => {
  needs({});
  await using den = await server({ place });
  await using desktop = await app({ den, as: "admin", place });

  const upload = await evalIn(desktop, `(async () => {
    const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
    const baseUrl = String(info?.baseUrl ?? info?.connectUrl ?? "").replace(/\\/+$/, "");
    const token = String(info?.ownerToken ?? info?.clientToken ?? "");
    const headers = { authorization: "Bearer " + token };
    const workspacesResponse = await fetch(baseUrl + "/workspaces", { headers });
    const workspaces = await workspacesResponse.json();
    const workspace = workspaces.items?.find((item) => item.id === ${JSON.stringify(desktop.workspaceId)});
    const form = new FormData();
    form.append("file", new File(["quarter,value\\nQ1,42\\n"], "input.csv", { type: "text/csv" }));
    form.append("path", "eval/input.csv");
    const response = await fetch(baseUrl + "/workspace/${encodeURIComponent(desktop.workspaceId)}/inbox", {
      method: "POST",
      headers,
      body: form,
    });
    const body = await response.json();
    const capabilitiesResponse = await fetch(baseUrl + "/capabilities", { headers });
    const capabilities = await capabilitiesResponse.json();
    return {
      status: response.status,
      body,
      workspacePath: workspace?.path,
      storage: capabilities.toolProviders?.files?.storage,
    };
  })()`, { awaitPromise: true, timeoutMs: 30_000 });

  if (!isRecord(upload) || !isRecord(upload.body)) throw new Error("Execution-storage upload response was invalid.");
  const executionPath = stringValue(upload.body.executionPath, "execution path");
  const workspacePath = stringValue(upload.workspacePath, "workspace path");
  expect(upload.status).toBe(200);
  expect(upload.storage).toBe("app-managed");
  expect(executionPath.startsWith(`${workspacePath}${sep}`)).toBe(false);

  const marker = `${sep}inbox${sep}`;
  const markerIndex = executionPath.lastIndexOf(marker);
  if (markerIndex < 1) throw new Error(`Execution path did not contain the inbox boundary: ${executionPath}`);
  const executionRoot = executionPath.slice(0, markerIndex);
  const generatedPath = join(executionRoot, "outbox", "generated", "summary.md");
  await mkdir(join(executionRoot, "outbox", "generated"), { recursive: true });
  await writeFile(generatedPath, "# Generated summary\n\nRevenue: 42\n", "utf8");

  const legacyExecutionDirectoryExists = await stat(join(workspacePath, ".opencode", "openwork"))
    .then(() => true)
    .catch(() => false);
  expect(legacyExecutionDirectoryExists).toBe(false);

  const artifact = await evalIn(desktop, `(async () => {
    const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
    const baseUrl = String(info?.baseUrl ?? info?.connectUrl ?? "").replace(/\\/+$/, "");
    const token = String(info?.ownerToken ?? info?.clientToken ?? "");
    const headers = { authorization: "Bearer " + token };
    const listResponse = await fetch(baseUrl + "/workspace/${encodeURIComponent(desktop.workspaceId)}/artifacts", { headers });
    const list = await listResponse.json();
    const item = list.items?.find((candidate) => candidate.path === "generated/summary.md");
    if (!item) return { listStatus: listResponse.status, item: null };
    const downloadResponse = await fetch(
      baseUrl + "/workspace/${encodeURIComponent(desktop.workspaceId)}/artifacts/" + encodeURIComponent(item.id),
      { headers },
    );
    return { listStatus: listResponse.status, item, downloadStatus: downloadResponse.status, text: await downloadResponse.text() };
  })()`, { awaitPromise: true, timeoutMs: 30_000 });

  if (!isRecord(artifact) || !isRecord(artifact.item)) throw new Error("Generated artifact was not listed by OpenWork.");
  expect(artifact.listStatus).toBe(200);
  expect(artifact.downloadStatus).toBe(200);
  expect(artifact.text).toContain("Revenue: 42");

  evidence.recordAssertionEvidence(
    "Uploaded and generated files use app-managed execution storage",
    "The upload returned an absolute non-workspace execution path, capabilities reported app-managed storage, and no .opencode/openwork directory appeared in the selected workspace.",
    true,
  );
  evidence.recordAssertionEvidence(
    "Generated artifacts remain listable and downloadable",
    "The generated Markdown artifact was listed through /artifacts and downloaded byte-for-byte through the app server.",
    artifact.text === "# Generated summary\n\nRevenue: 42\n",
  );
});

test.skipIf(!localPlacement || !mysqlOpen)(title, async ({ evidence, place }) => {
  needs({});
  const account = "native-files@openwork.test";
  await using google = await startMockGoogle({ accounts: [account], port: 0, autoApprove: false });
  const restoreEnvironment = installEnvironment(googleEnvironment(google));

  try {
    await using den = await server({ place });
    await connectGoogle(den.admin, google, account);
    const since = new Date().toISOString();
    const cases = [
      {
        type: "document",
        create: { type: "document", name: "Project brief", folderId: "handover-folder", text: "Draft one" },
        update: { type: "document", name: "Project brief final", text: "Draft two" },
        createPath: "/v1/documents",
      },
      {
        type: "spreadsheet",
        create: { type: "spreadsheet", name: "Project metrics", folderId: "handover-folder", sheetName: "Summary", values: [["Metric", "Value"], ["Revenue", 1742.42]] },
        update: { type: "spreadsheet", name: "Project metrics final", sheetName: "Summary", values: [["Metric", "Value"], ["Revenue", 1800]] },
        createPath: "/v4/spreadsheets",
      },
      {
        type: "presentation",
        create: { type: "presentation", name: "Project update", folderId: "handover-folder", slides: [{ title: "Launch", body: "Draft one" }] },
        update: { type: "presentation", name: "Project update final", slides: [{ title: "Launch", body: "Draft two" }] },
        createPath: "/v1/presentations",
      },
    ] as const;

    const fileIds: string[] = [];
    for (const item of cases) {
      const created = await nativeRequest(
        den.ref.apiUrl,
        den.admin,
        "/v1/capabilities/google-workspace/native-files",
        "POST",
        item.create,
      );
      const createdFile = isRecord(created.file) ? created.file : {};
      const fileId = stringValue(createdFile.id, `${item.type} file ID`);
      fileIds.push(fileId);
      expect(stringValue(createdFile.webViewLink, `${item.type} Drive link`)).toContain(fileId);
      expect(createdFile.name).toBe(item.create.name);

      const updated = await nativeRequest(
        den.ref.apiUrl,
        den.admin,
        `/v1/capabilities/google-workspace/native-file/${encodeURIComponent(fileId)}`,
        "PATCH",
        item.update,
      );
      const updatedFile = isRecord(updated.file) ? updated.file : {};
      expect(updatedFile.id).toBe(fileId);
      expect(updatedFile.name).toBe(item.update.name);
    }

    const operations = await google.nativeOperationsFor(account, { since, atLeast: 12, timeoutMs: 10_000 });
    const operationText = JSON.stringify(operations);
    for (const item of cases) expect(operations.some((entry) => entry.path === item.createPath)).toBe(true);
    for (const fileId of fileIds) {
      expect(operations.some((entry) => entry.path.startsWith(`/drive/v3/files/${fileId}?`) && entry.method === "PATCH")).toBe(true);
    }
    expect(operationText).toContain("Draft one");
    expect(operationText).toContain("Draft two");
    expect(operationText).toContain("Revenue");
    expect(operationText).toContain("1800");

    evidence.recordAssertionEvidence(
      "One explicit handover creates and then updates all three native Google file types",
      `Created ${fileIds.length} native files with provider-observed create/content/update/folder operations and real Drive links.`,
      fileIds.length === 3,
    );
    evidence.recordAssertionEvidence(
      "The provider observed both draft and replacement content",
      `Native operation paths: ${operations.map((entry) => `${entry.method} ${entry.path}`).join(", ")}.`,
      operationText.includes("Draft one") && operationText.includes("Draft two") && operationText.includes("1800"),
    );
  } finally {
    restoreEnvironment();
  }
});
