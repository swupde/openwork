import { expect } from "vitest";
import { spec } from "@openwork/testkit";
import { GENERATED_SUMMARY, managedDocumentStorage, nativeDocumentLifecycle } from "../worlds/documents-spreadsheets-lifecycle.ts";
import { isRecord, stringField } from "../worlds/library.ts";

const storage = spec.world(managedDocumentStorage, {
  needs: { placement: "local" }, timeout: 300_000,
  resources: { surfaces: ["appWeb"], services: [] },
});

storage("uploads and generated artifacts stay in app-managed execution storage", async ({ world, evidence }) => {
  const upload = await world.upload();
  expect(upload.status).toBe(200);
  expect(upload.storage).toBe("app-managed");
  expect(upload.outsideWorkspace).toBe(true);
  expect(upload.legacyExecutionDirectoryExists).toBe(false);
  evidence.recordAssertionEvidence("Files use app-managed execution storage", `storage=${upload.storage}; outside workspace=${upload.outsideWorkspace}; legacy directory=${upload.legacyExecutionDirectoryExists}`, upload.storage === "app-managed" && upload.outsideWorkspace && !upload.legacyExecutionDirectoryExists);
  const artifact = await world.generatedArtifact();
  expect(artifact.listStatus).toBe(200);
  expect(artifact.downloadStatus).toBe(200);
  expect(artifact.text).toBe(GENERATED_SUMMARY);
  evidence.recordAssertionEvidence("Generated artifacts remain listable and downloadable", `list=${artifact.listStatus}; download=${artifact.downloadStatus}; bytes match=${artifact.text === GENERATED_SUMMARY}`, artifact.listStatus === 200 && artifact.downloadStatus === 200 && artifact.text === GENERATED_SUMMARY);
});

const native = spec.world(nativeDocumentLifecycle, {
  needs: { placement: "local" }, timeout: 300_000,
  resources: { surfaces: [], services: ["den", "mock"] },
});

native("drafted content publishes and updates as native Google Docs, Sheets, and Slides", async ({ world, evidence }) => {
  const since = new Date().toISOString();
  const cases = [
    { type: "document", create: { type: "document", name: "Project brief", folderId: "handover-folder", text: "Draft one" }, update: { type: "document", name: "Project brief final", text: "Draft two" }, createPath: "/v1/documents" },
    { type: "spreadsheet", create: { type: "spreadsheet", name: "Project metrics", folderId: "handover-folder", sheetName: "Summary", values: [["Metric", "Value"], ["Revenue", 1742.42]] }, update: { type: "spreadsheet", name: "Project metrics final", sheetName: "Summary", values: [["Metric", "Value"], ["Revenue", 1800]] }, createPath: "/v4/spreadsheets" },
    { type: "presentation", create: { type: "presentation", name: "Project update", folderId: "handover-folder", slides: [{ title: "Launch", body: "Draft one" }] }, update: { type: "presentation", name: "Project update final", slides: [{ title: "Launch", body: "Draft two" }] }, createPath: "/v1/presentations" },
  ];
  const fileIds: string[] = [];
  for (const item of cases) {
    const created = await world.request("/v1/capabilities/google-workspace/native-files", "POST", item.create);
    expect(created.status).toBe(200);
    const file = isRecord(created.body) ? created.body.file : undefined;
    const fileId = stringField(file, "id");
    expect(fileId).not.toBe("");
    fileIds.push(fileId);
    expect(stringField(file, "webViewLink")).toContain(fileId);
    expect(stringField(file, "name")).toBe(item.create.name);
    const updated = await world.request(`/v1/capabilities/google-workspace/native-file/${encodeURIComponent(fileId)}`, "PATCH", item.update);
    expect(updated.status).toBe(200);
    const replacement = isRecord(updated.body) ? updated.body.file : undefined;
    expect(stringField(replacement, "id")).toBe(fileId);
    expect(stringField(replacement, "name")).toBe(item.update.name);
  }
  const operations = await world.operations(since);
  const operationText = JSON.stringify(operations);
  for (const item of cases) expect(operations.some((entry) => entry.path === item.createPath)).toBe(true);
  for (const fileId of fileIds) expect(operations.some((entry) => entry.path.startsWith(`/drive/v3/files/${fileId}?`) && entry.method === "PATCH")).toBe(true);
  for (const text of ["Draft one", "Draft two", "Revenue", "1800"]) expect(operationText).toContain(text);
  evidence.recordAssertionEvidence("Native Google files retain their IDs while replacing their contents", `Created and updated ${fileIds.length} files; provider observed ${operations.length} create/content/update/folder operations.`, fileIds.length === 3 && operationText.includes("Draft one") && operationText.includes("Draft two") && operationText.includes("1800"));
});
