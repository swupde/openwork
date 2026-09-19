import { legacyExecutionPermissions } from "./managed-policy-rules.js";
import { materializeLegacyFastProviders } from "@openwork/types/cloud-model-fast";
import { isManagedPolicyPlugin } from "./managed-policy-plugin.js";
/**
 * Runtime OpenCode configuration injected via a server-managed config file
 * passed to the engine as OPENCODE_CONFIG.
 *
 * This is the single source of truth for the openwork agent definition,
 * plugins, and any other config that should be injected at runtime rather
 * than written to the user's own config files. Both cli.ts and embedded.ts
 * use this.
 *
 * The engine re-reads the OPENCODE_CONFIG file from disk on every instance
 * rebuild (e.g. /instance/dispose), so the file is synchronized on every
 * runtime-DB write — unlike the previous OPENCODE_CONFIG_CONTENT env var,
 * which was frozen at spawn and reverted MCP state on each dispose.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  openworkExtensionsPreviewPluginPath,
  openworkCapabilitiesKnowledgePluginPath,
  openworkAnthropicAdaptiveThinkingPluginPath,
  openworkAnthropicToolSchemaPluginPath,
  openworkTitleRecoveryPluginPath,
  openworkOfficeAttachmentsPluginPath,
  openworkSpreadsheetsPluginPath,
  openworkChromeDevtoolsPluginPath,
  openworkPdfAttachmentsPluginPath,
} from "./openwork-extensions-plugin-path.js";
import type { ServerConfig } from "./types.js";
import { runtimeStorageDir } from "./runtime-db.js";
import { runtimeWorkspaceFilesRoot, runtimeWorkspaceOutboxDir } from "./runtime-workspace-files.js";
import {
  onRuntimeOpencodeConfigWrite,
  isEngineGlobalRuntimeConfigId,
  readGlobalRuntimeOpencodeConfig,
  runtimeDisabledProviderList,
  runtimeMcpMap,
  runtimeProviderMap,
  runtimePluginList,
  type RuntimeOpencodeConfig,
} from "./runtime-opencode-config-store.js";
import { CONNECT_MCP_SERVER_NAME_PREFIX } from "./connect-mcp-server-catalog.js";
import { findManagedEngineWorkspace } from "./workspaces.js";
import { OPENWORK_AGENT_PROMPT } from "./openwork-agent-prompt.js";

export async function buildOpenworkRuntimeConfigObject(
  config?: ServerConfig,
  workspaceId?: string,
): Promise<Record<string, unknown>> {
  // OPENCODE_CONFIG is shared by the managed engine. Workspace MCPs are
  // delivered by the dynamic engine push, so this file may contain only the
  // engine-global runtime layer.
  const runtimeConfig = config ? await readGlobalRuntimeOpencodeConfig(config) : {};
  const result = buildOpenworkRuntimeConfigObjectFromSnapshot(runtimeConfig);
  const workspace = config && workspaceId
    ? config.workspaces.find((entry) => entry.id === workspaceId && entry.workspaceType !== "remote" && entry.path.trim())
    : undefined;
  if (!config || !workspace) return result;

  const executionRoot = runtimeWorkspaceFilesRoot(runtimeStorageDir(config), workspace.path);
  const outputDirectory = runtimeWorkspaceOutboxDir(runtimeStorageDir(config), workspace.path);
  const permission = isRecord(result.permission) ? result.permission : {};
  const externalDirectory = isRecord(permission.external_directory) ? permission.external_directory : {};
  const executionGlob = join(executionRoot, "**");
  const agent = isRecord(result.agent) ? result.agent : {};
  const openwork = isRecord(agent.openwork) ? agent.openwork : {};
  const basePrompt = typeof openwork.prompt === "string" ? openwork.prompt : OPENWORK_AGENT_PROMPT;
  return {
    ...result,
    agent: {
      ...agent,
      openwork: {
        ...openwork,
        prompt: `${basePrompt}\n\n## Execution output directory\n\nFor this workspace, the app-managed execution output directory is ${outputDirectory}. Save generated working files and deliverables there so OpenWork can list, preview, and download them without adding hidden files to the user's selected workspace.`,
      },
    },
    permission: {
      ...permission,
      external_directory: {
        ...externalDirectory,
        [executionGlob]: "allow",
      },
    },
  };
}

export function buildOpenworkRuntimeConfigObjectFromSnapshot(
  runtimeConfig: RuntimeOpencodeConfig,
): Record<string, unknown> {
  const disabledProviders = runtimeDisabledProviderList(runtimeConfig);
  const permissions = legacyExecutionPermissions(runtimeConfig.managedPolicy?.execution);
  const { managedPolicy: _managedPolicy, ...engineConfig } = runtimeConfig;
  const provider = materializeLegacyFastProviders(runtimeProviderMap(runtimeConfig));
  return {
    ...engineConfig,
    ...(runtimeConfig.managedPolicy?.allowCustomProviders === false ? { enabled_providers: [
      ...Object.keys(provider).filter((id) => /^(?:lpr_|ipr_|openwork$)/i.test(id)),
      ...(runtimeConfig.managedPolicy.allowZenModel !== false ? ["opencode"] : []),
    ] } : {}),
    permission: { ...engineConfig.permission, ...permissions },
    default_agent: runtimeConfig.default_agent ?? "openwork",
    agent: {
      openwork: {
        description: "OpenWork default agent",
        mode: "primary",
        temperature: 0.2,
        prompt: OPENWORK_AGENT_PROMPT,
        permission: {
          ...permissions,
          skill: {
            // OpenWork supplies its own current skill routing and no longer
            // supports these engine or legacy workspace skills.
            "customize-opencode": "deny",
            "get-started": "deny",
            "command-creator": "deny",
            "agent-creator": "deny",
            "plugin-creator": "deny",
            "using-superpowers": "deny",
          },
        },
      },
    },
    plugin: [
      openworkChromeDevtoolsPluginPath(),
      // Registration order is prompt order: the knowledge plugin appends the
      // operating rules first, then the extensions plugin adds app-control
      // mechanics, live Connect steering, and the remote skill and Automation
      // catalogs, so rules precede state and state precedes data.
      openworkCapabilitiesKnowledgePluginPath(),
      openworkExtensionsPreviewPluginPath(),
      openworkOfficeAttachmentsPluginPath(),
      openworkSpreadsheetsPluginPath(),
      openworkPdfAttachmentsPluginPath(),
      openworkAnthropicAdaptiveThinkingPluginPath(),
      openworkAnthropicToolSchemaPluginPath(),
      openworkTitleRecoveryPluginPath(),
      ...runtimePluginList(runtimeConfig).filter((plugin) => !isManagedPolicyPlugin(plugin)),
    ],
    ...(disabledProviders.length ? { disabled_providers: disabledProviders } : {}),
    mcp: Object.fromEntries(Object.entries(runtimeMcpMap(runtimeConfig))
      .filter(([name]) => !name.startsWith(CONNECT_MCP_SERVER_NAME_PREFIX))),
    ...(Object.keys(provider).length ? { provider } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

export async function buildOpenworkRuntimeConfig(config?: ServerConfig, workspaceId?: string): Promise<string> {
  return stableStringify(await buildOpenworkRuntimeConfigObject(config, workspaceId));
}

export function openworkRuntimeConfigFilePath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "runtime-opencode-config.json");
}

// Serialize file writes per path so a slow older write can never land after
// (and clobber) a newer one. Content is built inside the queued job so each
// job reads the latest runtime-DB state.
export interface OpenworkRuntimeConfigWriteResult {
  path: string;
  changed: boolean;
}

const fileWriteQueue = new Map<string, Promise<OpenworkRuntimeConfigWriteResult>>();
const managedRuntimeWorkspaceIds = new WeakMap<ServerConfig, string>();

function managedRuntimeWorkspaceId(config: ServerConfig): string | undefined {
  const cached = managedRuntimeWorkspaceIds.get(config);
  if (cached && config.workspaces.some((workspace) => workspace.id === cached && workspace.workspaceType !== "remote" && workspace.path.trim())) {
    return cached;
  }
  const workspaceId = findManagedEngineWorkspace(config.workspaces)?.id;
  if (workspaceId) managedRuntimeWorkspaceIds.set(config, workspaceId);
  return workspaceId;
}

/**
 * Rebuild the engine-visible runtime config file from the runtime DB.
 * Atomic (temp file + rename) so the engine never reads a partial file
 * mid-dispose.
 */
export async function writeOpenworkRuntimeConfigFile(
  config: ServerConfig,
  workspaceId?: string,
): Promise<OpenworkRuntimeConfigWriteResult> {
  const path = openworkRuntimeConfigFilePath(config);
  // Activation reorders `config.workspaces`, but the already-running engine
  // must retain the same app-managed execution directory until it restarts.
  const resolvedWorkspaceId = workspaceId ?? managedRuntimeWorkspaceId(config);
  const job = async () => {
    const content = await buildOpenworkRuntimeConfig(config, resolvedWorkspaceId);
    const current = await readFile(path, "utf8").catch(() => undefined);
    if (current === content) return { path, changed: false };
    await mkdir(runtimeStorageDir(config), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
    return { path, changed: true };
  };
  const previous = fileWriteQueue.get(path) ?? Promise.resolve();
  const next = previous.then(job, job);
  fileWriteQueue.set(path, next);
  return await next;
}

/**
 * Keep the runtime config file in sync with the runtime DB so every engine
 * instance rebuild reads fresh state instead of a spawn-time snapshot.
 * Returns an unsubscribe function.
 */
export function keepOpenworkRuntimeConfigFileFresh(config: ServerConfig, workspaceId?: string): () => void {
  const resolvedWorkspaceId = workspaceId ?? managedRuntimeWorkspaceId(config);
  if (!resolvedWorkspaceId) return () => undefined;
  return onRuntimeOpencodeConfigWrite((_writeConfig, writtenWorkspaceId) => {
    if (!isEngineGlobalRuntimeConfigId(writtenWorkspaceId)) return;
    void writeOpenworkRuntimeConfigFile(config, resolvedWorkspaceId).catch(() => undefined);
  });
}
