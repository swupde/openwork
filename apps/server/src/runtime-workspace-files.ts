import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

export const OPENWORK_RUNTIME_STORAGE_ENV = "OPENWORK_RUNTIME_STORAGE_DIR";

function workspaceStorageKey(workspaceRoot: string): string {
  return createHash("sha256").update(resolve(workspaceRoot)).digest("hex").slice(0, 24);
}

export function runtimeWorkspaceFilesRoot(runtimeRoot: string, workspaceRoot: string): string {
  return join(resolve(runtimeRoot), "workspace-files", workspaceStorageKey(workspaceRoot));
}

export function runtimeWorkspaceInboxDir(runtimeRoot: string, workspaceRoot: string): string {
  return join(runtimeWorkspaceFilesRoot(runtimeRoot, workspaceRoot), "inbox");
}

export function runtimeWorkspaceOutboxDir(runtimeRoot: string, workspaceRoot: string): string {
  return join(runtimeWorkspaceFilesRoot(runtimeRoot, workspaceRoot), "outbox");
}
