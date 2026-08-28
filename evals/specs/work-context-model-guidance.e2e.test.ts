import { expect, onTestFinished } from "vitest";
import { denFetch, evalIn, go, readAvailableModels, selectModel, waitFor } from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { app, needs, server, test } from "@openwork/testkit";

const ORGANIZATION_NAME = "Work Context Model Guidance";
const PROVIDER_NAME = "Work Context Policy Models";
const PROVIDER_KEY = "swup-work-context-policy";
const REQUEST_TIMEOUT_MS = 10_000;

const INTERNAL_MODELS = [
  "openai-terra",
  "openai-sol",
  "claude-opus",
  "claude-fable",
] as const;
const CLIENT_MODEL = "nemotron-super-3-120b";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function auth(session: DenSession): Record<string, string> {
  return { authorization: `Bearer ${session.token}` };
}

async function organizationId(session: DenSession): Promise<string> {
  const result = await denFetch(session, "/v1/me/orgs", {
    headers: auth(session),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const organizations = isRecord(result.body) && Array.isArray(result.body.orgs)
    ? result.body.orgs.filter(isRecord)
    : [];
  const organization = organizations.find((entry) => entry.name === ORGANIZATION_NAME);
  const id = organization && typeof organization.id === "string" ? organization.id : "";
  if (!result.response.ok || !id) {
    throw new Error(`Finding the test organization failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return id;
}

function internalModel(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    openwork: { alias: id, dataContexts: ["internal"] },
  };
}

async function createProvider(admin: DenSession, orgId: string): Promise<string> {
  const result = await denFetch(admin, "/v1/llm-providers", {
    method: "POST",
    headers: { ...auth(admin), "x-openwork-org-id": orgId },
    body: JSON.stringify({
      name: PROVIDER_NAME,
      source: "custom",
      customConfig: {
        id: PROVIDER_KEY,
        name: PROVIDER_NAME,
        npm: "@ai-sdk/openai-compatible",
        env: ["WORK_CONTEXT_POLICY_EVAL_KEY"],
        models: [
          ...INTERNAL_MODELS.map(internalModel),
          {
            id: CLIENT_MODEL,
            name: CLIENT_MODEL,
            openwork: {
              alias: CLIENT_MODEL,
              dataContexts: ["client"],
              deployment: {
                provider: "bedrock",
                region: "eu-central-1",
                inferenceMode: "in-region",
                providerModelId: "nvidia.nemotron-super-3-120b",
              },
              verification: {
                status: "verified",
                verifiedAt: "2026-08-27T12:00:00.000Z",
                evidenceRef: "local-eval-fixture",
              },
            },
          },
          {
            id: "minimax-m2.5",
            name: "MiniMax M2.5",
            attachment: true,
            modalities: { input: ["text", "image"], output: ["text"] },
            openwork: { alias: "minimax-m2.5", dataContexts: ["internal"] },
          },
        ],
      },
      apiKey: "openwork-work-context-eval-only-test-token",
      allMembers: true,
      memberIds: [],
      teamIds: [],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const provider = isRecord(result.body) && isRecord(result.body.llmProvider)
    ? result.body.llmProvider
    : null;
  const id = provider && typeof provider.id === "string" ? provider.id : "";
  if (result.response.status !== 201 || !id) {
    throw new Error(`Creating the policy provider failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return id;
}

async function deleteProvider(admin: DenSession, orgId: string, providerId: string): Promise<void> {
  await denFetch(admin, `/v1/llm-providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
    headers: { ...auth(admin), "x-openwork-org-id": orgId },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function changeSelect(
  desktopApp: Awaited<ReturnType<typeof app>>,
  ariaLabel: "Data context" | "Work mode",
  value: string,
): Promise<void> {
  await waitFor(desktopApp, `(() => {
    const select = document.querySelector('select[aria-label=${JSON.stringify(ariaLabel)}]');
    return select instanceof HTMLSelectElement && !select.disabled;
  })()`, {
    timeoutMs: 120_000,
    label: `enabled ${ariaLabel} control`,
  });
  const changed = await evalIn(desktopApp, `(() => {
    const select = document.querySelector('select[aria-label=${JSON.stringify(ariaLabel)}]');
    if (!(select instanceof HTMLSelectElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  expect(changed).toBe(true);
  await waitFor(desktopApp, `document.querySelector('select[aria-label=${JSON.stringify(ariaLabel)}]')?.value === ${JSON.stringify(value)}`, {
    timeoutMs: 30_000,
    label: `${ariaLabel} persisted in the visible control`,
  });
}

async function readContextState(desktopApp: Awaited<ReturnType<typeof app>>): Promise<Record<string, unknown>> {
  const state = await evalIn(desktopApp, `(() => {
    const bar = document.querySelector('[data-testid="work-context-bar"]');
    const data = document.querySelector('select[aria-label="Data context"]');
    const mode = document.querySelector('select[aria-label="Work mode"]');
    const run = document.querySelector('button[aria-label="Run task"]');
    return {
      visible: Boolean(bar),
      dataContext: data instanceof HTMLSelectElement ? data.value : "",
      workMode: mode instanceof HTMLSelectElement ? mode.value : "",
      text: bar?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      sendDisabled: run instanceof HTMLButtonElement ? run.disabled : null,
      bodyText: document.body.innerText,
    };
  })()`);
  if (!isRecord(state)) throw new Error("Work-context UI state was not an object.");
  return state;
}

async function waitForModelIds(
  desktopApp: Awaited<ReturnType<typeof app>>,
  expected: readonly string[],
): Promise<Awaited<ReturnType<typeof readAvailableModels>>> {
  const wanted = [...expected].sort();
  const deadline = Date.now() + 120_000;
  let last: Awaited<ReturnType<typeof readAvailableModels>> = [];
  while (Date.now() < deadline) {
    last = await readAvailableModels(desktopApp);
    if (JSON.stringify(last.map((model) => model.id).sort()) === JSON.stringify(wanted)) return last;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Expected model IDs ${JSON.stringify(wanted)}, observed ${JSON.stringify(last.map((model) => model.id).sort())}.`);
}

async function readProviderModelsOnce(
  desktopApp: Awaited<ReturnType<typeof app>>,
): Promise<Record<string, Record<string, unknown>>> {
  const result = await evalIn(desktopApp, `(async () => {
    const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
    if (!info?.running || !info.baseUrl || !info.clientToken) return { error: "local_server_unavailable" };
    const response = await fetch(
      String(info.baseUrl).replace(/\\/+$/, "") + "/workspace/${encodeURIComponent(desktopApp.workspaceId)}/opencode/provider",
      {
        headers: { Authorization: "Bearer " + String(info.clientToken) },
        signal: AbortSignal.timeout(${REQUEST_TIMEOUT_MS}),
      },
    );
    return { status: response.status, body: await response.json().catch(() => null) };
  })()`, { awaitPromise: true, timeoutMs: 30_000 });
  if (!isRecord(result) || result.status !== 200 || !isRecord(result.body)) {
    throw new Error(`Reading OpenCode /provider failed: ${JSON.stringify(result)}`);
  }
  const providers = Array.isArray(result.body.all) ? result.body.all.filter(isRecord) : [];
  const models: Record<string, Record<string, unknown>> = {};
  for (const provider of providers) {
    if (!isRecord(provider.models)) continue;
    for (const [id, model] of Object.entries(provider.models)) {
      if (isRecord(model)) models[id] = model;
    }
  }
  return models;
}

async function readCloudProviderSyncStatus(
  desktopApp: Awaited<ReturnType<typeof app>>,
): Promise<Record<string, unknown>> {
  const result = await evalIn(desktopApp, `(async () => {
    const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
    if (!info?.running || !info.baseUrl || !info.clientToken) return { error: "local_server_unavailable" };
    const response = await fetch(String(info.baseUrl).replace(/\\/+$/, "") + "/cloud-provider-sync/status", {
      headers: { Authorization: "Bearer " + String(info.clientToken) },
      signal: AbortSignal.timeout(${REQUEST_TIMEOUT_MS}),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  })()`, { awaitPromise: true, timeoutMs: 30_000 });
  if (!isRecord(result) || result.status !== 200 || !isRecord(result.body)) {
    throw new Error(`Reading cloud-provider sync status failed: ${JSON.stringify(result)}`);
  }
  return result.body;
}

async function waitForProviderImageCapabilities(
  desktopApp: Awaited<ReturnType<typeof app>>,
): Promise<Record<string, Record<string, unknown>>> {
  const deadline = Date.now() + 120_000;
  let last: Record<string, Record<string, unknown>> = {};
  while (Date.now() < deadline) {
    last = await readProviderModelsOnce(desktopApp);
    const ready = INTERNAL_MODELS.every((id) => {
      const model = last[id];
      const capabilities = isRecord(model?.capabilities) ? model.capabilities : null;
      const input = capabilities && isRecord(capabilities.input) ? capabilities.input : null;
      return capabilities?.attachment === true && input?.image === true;
    });
    if (ready) return last;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const syncStatus = await readCloudProviderSyncStatus(desktopApp);
  const retainedSnapshots = Object.fromEntries(
    INTERNAL_MODELS.map((id) => [id, last[id]?.capabilities ?? null]),
  );
  throw new Error(`OpenCode /provider never exposed all image-capable retained models. Retained model capabilities: ${JSON.stringify(retainedSnapshots)}. Cloud provider sync status: ${JSON.stringify(syncStatus)}.`);
}

test("work modes guide model choice while client data fails closed to verified EU Nemotron", async ({ evidence, place }) => {
  needs({ optIn: ["OPENWORK_EVAL_E2E_TESTS"] });
  await using den = await server({
    place,
    org: {
      name: ORGANIZATION_NAME,
      admin: { name: "Context Admin" },
      members: { member: { name: "Context Member" } },
    },
  });
  const orgId = await organizationId(den.admin);
  const providerId = await createProvider(den.admin, orgId);
  onTestFinished(async () => {
    await deleteProvider(den.admin, orgId, providerId).catch(() => undefined);
  });

  await using desktopApp = await app({ den, as: "member", place });
  await go(desktopApp, `/workspace/${desktopApp.workspaceId}/session`);
  await waitFor(desktopApp, `Boolean(document.querySelector('[data-testid="work-context-bar"]'))`, {
    timeoutMs: 120_000,
    label: "work-context bar",
  });

  const initial = await readContextState(desktopApp);
  expect(initial.dataContext).toBe("internal");
  expect(initial.workMode).toBe("everyday");
  expect(String(initial.bodyText)).toContain("Internal work only");
  expect(String(initial.bodyText)).toContain("Everyday Work");
  expect(String(initial.text)).toContain("Recommended: OpenAI Terra");
  expect(String(initial.text)).not.toContain("openai-terra");

  const expectedRecommendations: Record<string, string> = {
    everyday: "Recommended: OpenAI Terra",
    "research-decisions": "Recommended: Claude Opus",
    "complex-analysis": "Recommended: Claude Fable",
    "build-automate": "Recommended: OpenAI Sol",
    "documents-spreadsheets": "Recommended: OpenAI Terra; alternative: Claude Opus",
  };
  for (const [mode, recommendation] of Object.entries(expectedRecommendations)) {
    await changeSelect(desktopApp, "Work mode", mode);
    await waitFor(desktopApp, `document.querySelector('[data-testid="work-context-bar"]')?.textContent?.replace(/\\s+/g, " ").includes(${JSON.stringify(recommendation)}) === true`, {
      timeoutMs: 30_000,
      label: `${mode} recommendation`,
    });
  }

  const internalModels = await waitForModelIds(desktopApp, INTERNAL_MODELS);
  expect(internalModels.map((model) => model.id).sort()).toEqual([...INTERNAL_MODELS].sort());
  expect(internalModels.map((model) => model.name).sort()).toEqual([
    "Claude Fable",
    "Claude Opus",
    "OpenAI Sol",
    "OpenAI Terra",
  ]);
  expect(internalModels.some((model) => model.id.includes("minimax"))).toBe(false);
  const providerModels = await waitForProviderImageCapabilities(desktopApp);
  for (const id of INTERNAL_MODELS) {
    const capabilities = isRecord(providerModels[id]?.capabilities)
      ? providerModels[id].capabilities
      : null;
    const input = capabilities && isRecord(capabilities.input) ? capabilities.input : null;
    expect(capabilities?.attachment).toBe(true);
    expect(input?.image).toBe(true);
  }
  await selectModel(desktopApp, "openai-terra");

  await changeSelect(desktopApp, "Data context", "client");
  await waitFor(desktopApp, `document.body.innerText.includes("Client data requires the approved EU-hosted Nemotron model.")`, {
    timeoutMs: 30_000,
    label: "client-data fail-closed explanation",
  });
  const blocked = await readContextState(desktopApp);
  expect(blocked.sendDisabled).toBe(true);
  expect(String(blocked.bodyText)).toContain("Client data — EU hosted only");
  expect(String(blocked.bodyText)).toContain("Client data uses only the approved EU-hosted Nemotron model.");
  expect(String(blocked.text)).toContain("Recommended: Nemotron");
  expect(String(blocked.text)).not.toContain(CLIENT_MODEL);
  expect(String(blocked.text)).not.toContain("Recommended: OpenAI Terra");

  const clientModels = await waitForModelIds(desktopApp, [CLIENT_MODEL]);
  expect(clientModels.map((model) => model.id)).toEqual([CLIENT_MODEL]);
  expect(clientModels.map((model) => model.name)).toEqual(["Nemotron"]);
  expect(clientModels.some((model) => model.id.includes("minimax"))).toBe(false);
  await selectModel(desktopApp, CLIENT_MODEL);

  await evalIn(desktopApp, "location.reload()");
  await waitFor(desktopApp, `document.querySelector('select[aria-label="Data context"]')?.value === "client"
    && document.querySelector('select[aria-label="Work mode"]')?.value === "documents-spreadsheets"`, {
    timeoutMs: 120_000,
    label: "persisted work context after reload",
  });
  const reloaded = await readContextState(desktopApp);
  expect(reloaded.dataContext).toBe("client");
  expect(reloaded.workMode).toBe("documents-spreadsheets");
  expect(String(reloaded.text)).toContain("Recommended: Nemotron");
  expect(String(reloaded.text)).not.toContain(CLIENT_MODEL);

  evidence.recordAssertionEvidence(
    "Colleagues choose a work mode and data context instead of a gateway route",
    `Observed recommendations: ${JSON.stringify(expectedRecommendations)}; persisted state after reload: ${JSON.stringify({ dataContext: reloaded.dataContext, workMode: reloaded.workMode })}.`,
    reloaded.dataContext === "client" && reloaded.workMode === "documents-spreadsheets",
  );
  evidence.recordAssertionEvidence(
    "Model visibility enforces the two data boundaries",
    `Internal picker: ${internalModels.map((model) => model.id).join(", ")}; client picker: ${clientModels.map((model) => model.id).join(", ")}; /provider image-capable models: ${INTERNAL_MODELS.filter((id) => {
      const capabilities = isRecord(providerModels[id]?.capabilities) ? providerModels[id].capabilities : null;
      return capabilities?.attachment === true && isRecord(capabilities.input) && capabilities.input.image === true;
    }).join(", ")}.`,
    internalModels.length === 4 && clientModels.length === 1 && clientModels[0]?.id === CLIENT_MODEL,
  );
});
