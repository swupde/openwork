import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { localMysqlIsRunning, localRedisIsRunning, SkipError, type Seed } from "@openwork/env";
import { startMockGoogle } from "@openwork/labs";
import { isRecord, records, stringField } from "./library.ts";

export const GENERATED_SUMMARY = "# Generated summary\n\nRevenue: 42\n";

/** Synthetic public API client: its token is chosen before boot, never read from the renderer. */
export async function managedDocumentStorage(seed: Seed) {
  const directory = await mkdtemp(`${seed.tmpPath("document-storage-workspace")}-`);
  let stopApp: (() => Promise<void>) | undefined;
  try {
    const workspacePath = await realpath(directory);
    const token = randomUUID();
    const app = await seed.appWeb({ workspacePath, name: "document-storage", headless: true, env: { OPENWORK_TOKEN: token } });
    stopApp = () => app.stop();
    const headers = { authorization: `Bearer ${token}` };
    const listing = await fetch(`${app.openworkUrl}/workspaces`, { headers }).then((response) => response.json());
    const workspace = records(isRecord(listing) ? listing.workspaces : undefined).find((row) => row.path === workspacePath);
    const workspaceId = stringField(workspace, "id");
    if (!workspaceId) throw new Error("The document-storage workspace is not registered.");
    const base = `${app.openworkUrl}/workspace/${encodeURIComponent(workspaceId)}`;
    let executionRoot = "";
    return {
      app,
      async [Symbol.asyncDispose]() {
        try { await app.stop(); }
        finally { await rm(directory, { recursive: true, force: true }); }
      },
      async upload() {
        const form = new FormData();
        form.append("file", new File(["quarter,value\nQ1,42\n"], "input.csv", { type: "text/csv" }));
        form.append("path", "eval/input.csv");
        const response = await fetch(`${base}/inbox`, { method: "POST", headers, body: form });
        const body: unknown = await response.json();
        const executionPath = stringField(body, "executionPath");
        const markerIndex = executionPath.lastIndexOf(`${sep}inbox${sep}`);
        if (!response.ok || markerIndex < 1) throw new Error(`Execution upload failed: HTTP ${response.status}`);
        executionRoot = executionPath.slice(0, markerIndex);
        const capabilities = await fetch(`${app.openworkUrl}/capabilities`, { headers }).then((result) => result.json());
        const providers = isRecord(capabilities) && isRecord(capabilities.toolProviders) ? capabilities.toolProviders : {};
        const files = isRecord(providers.files) ? providers.files : {};
        return {
          status: response.status, executionPath, workspacePath, storage: files.storage,
          outsideWorkspace: !executionPath.startsWith(`${workspacePath}${sep}`),
          legacyExecutionDirectoryExists: await stat(join(workspacePath, ".opencode", "openwork")).then(() => true).catch(() => false),
        };
      },
      /** Arrange output as a generator would, then observe listing/download through the public server API. */
      async generatedArtifact() {
        if (!executionRoot) throw new Error("Upload must establish the app-managed execution directory first.");
        const path = join(executionRoot, "outbox", "generated", "summary.md");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, GENERATED_SUMMARY, "utf8");
        const response = await fetch(`${base}/artifacts`, { headers });
        const body: unknown = await response.json();
        const artifact = records(isRecord(body) ? body.items : undefined).find((row) => row.path === "generated/summary.md");
        const artifactId = stringField(artifact, "id");
        if (!artifactId) throw new Error("Generated document was not listed by the public artifacts API.");
        const download = await fetch(`${base}/artifacts/${encodeURIComponent(artifactId)}`, { headers });
        return { listStatus: response.status, downloadStatus: download.status, text: await download.text() };
      },
    };
  } catch (error) {
    try { await stopApp?.(); }
    finally { await rm(directory, { recursive: true, force: true }); }
    throw error;
  }
}

/** Only Google is synthetic; connector setup, consent callback and native file routes run in a real isolated Den. */
export async function nativeDocumentLifecycle(seed: Seed) {
  if (!await localMysqlIsRunning()) throw new SkipError("MySQL at OPENWORK_EVAL_MYSQL_URL or 127.0.0.1:3306");
  if (!await localRedisIsRunning()) throw new SkipError("Redis at DATABASE_REDIS_URL or 127.0.0.1:6379");
  const account = "native-files@openwork.test";
  const google = await startMockGoogle({ accounts: [account], port: 0, autoApprove: false, nativeFileLifecycle: true });
  try {
    const den = await seed.den({ web: false, env: {
      DEN_GOOGLE_API_BASE_URL: google.apiUrl,
      DEN_GOOGLE_OAUTH_AUTHORIZE_URL: google.authorizeUrl,
      DEN_GOOGLE_OAUTH_TOKEN_URL: google.tokenUrl,
      DEN_GOOGLE_OAUTH_USERINFO_URL: google.userinfoUrl,
    } });
    const connector = await seed.nativeConnector(den.admin, {
      providerKey: "google-workspace", name: "Google Workspace",
      clientId: "native-files-spec-client", clientSecret: "native-files-spec-secret", features: ["driveFile"],
    });
    const started = await seed.api(den.admin, `/v1/oauth-providers/${encodeURIComponent(connector.id)}/connect/start`);
    const authorizeUrl = stringField(started.body, "authorizeUrl");
    if (!started.response.ok || !authorizeUrl) throw new Error(`Google sign-in start failed: HTTP ${started.response.status}`);
    const authorize = await fetch(authorizeUrl, { redirect: "manual" });
    await authorize.arrayBuffer();
    if (!authorize.ok) throw new Error(`Synthetic Google chooser failed: HTTP ${authorize.status}`);
    const consent = await google.chooseAccount(account, { timeoutMs: 10_000 });
    if (consent.status >= 400) throw new Error(`Synthetic Google callback failed: HTTP ${consent.status}`);
    return {
      den,
      request: async (path: string, method: "POST" | "PATCH", body: unknown) => {
        const result = await seed.api(den.admin, path, { method, body: JSON.stringify(body) });
        if (!result.response.ok) throw new Error(`Native file ${method} ${path}: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
        return { status: result.response.status, body: result.body };
      },
      operations: (since: string) => google.nativeOperationsFor(account, { since, atLeast: 12, timeoutMs: 10_000 }),
      async [Symbol.asyncDispose]() { await google[Symbol.asyncDispose](); },
    };
  } catch (error) {
    await google[Symbol.asyncDispose]();
    throw error;
  }
}
