import { describe, expect, test } from "bun:test";
import { attachmentNoteText, composeV2Prompt, splitV2Prompt } from "../src/app/lib/v2-prompt-context";

import { composerAttachmentsToWorkspaceFileParts, isChatAttachmentUrl } from "../src/react-app/domains/session/sync/attachment-file-part";

const attachment = {
  filename: "report.pdf",
  executionPath: "/runtime/workspace-files/workspace-key/inbox/chat-attachments/session/report.pdf",
  url: "file:///runtime/workspace-files/workspace-key/inbox/chat-attachments/session/report.pdf",
  bytes: 2048,
};

describe("managed attachment prompt context", () => {
  test("round-trips execution paths and bytes without showing hidden context as user text", () => {
    const note = attachmentNoteText([attachment]);
    expect(note).toContain("OpenWork's app-managed execution storage");
    expect(note).toContain(attachment.executionPath);
    expect(note).not.toContain("undefined");
    const result = splitV2Prompt(composeV2Prompt("Read this report", [note]));
    expect(result.segments).toEqual([{ kind: "text", text: "Read this report" }]);
    expect(result.attachments).toEqual([{ filename: attachment.filename, mime: "application/octet-stream", url: attachment.url, bytes: 2048 }]);
  });

  for (const location of ["this worker workspace", "OpenWork's app-managed execution storage"]) {
    test(`reads older inline attachment notes using ${location}`, () => {
      const note = `Attached files were copied into ${location} for tool access:\n- report.pdf: ${attachment.executionPath} (${attachment.url})\nUse these paths with Read/Bash/MCP/Docling when a tool needs the file bytes.`;
      const result = splitV2Prompt(`Read this report\n\n${note}`);
      expect(result.segments.map((part) => part.text).join("").trim()).toBe("Read this report");
      expect(result.attachments).toEqual([{ filename: attachment.filename, mime: "application/octet-stream", url: attachment.url }]);
    });
  }
});


test("recognizes current and historical chat attachments without hiding ordinary file mentions", () => {
  expect(isChatAttachmentUrl(attachment.url)).toBe(true);
  expect(isChatAttachmentUrl("file:///workspace/.opencode/openwork/inbox/chat-attachments/session/report.pdf")).toBe(true);
  expect(isChatAttachmentUrl("file:///workspace/inbox/chat-attachments/report.pdf")).toBe(false);
  expect(isChatAttachmentUrl("https://example.com/inbox/chat-attachments/report.pdf")).toBe(false);
});

test("upload uses the server execution path in the new prompt format and retained file references", async () => {
  const file = new File(["data"], "report.pdf", { type: "application/pdf" });
  const result = await composerAttachmentsToWorkspaceFileParts({
    attachments: [{ id: "report", name: file.name, mimeType: file.type, size: file.size, kind: "file", file }],
    endpoint: { workspaceId: "workspace", client: { uploadInbox: async (_id, value, options) => ({
      ok: true, path: options?.path ?? value.name, executionPath: attachment.executionPath, bytes: value.size,
    }) } },
    sessionId: "session",
    preserveWorkspaceFiles: true,
  });
  if (!result) throw new Error("Expected uploaded attachment parts");
  expect(result.files[0]?.url).toBe(attachment.url);
  expect(result?.workspaceFiles?.[0]?.url).toBe(attachment.url);
  expect(splitV2Prompt(composeV2Prompt("Read", [result.note.text])).attachments[0]).toEqual({
    filename: "report.pdf", mime: "application/octet-stream", url: attachment.url, bytes: 4,
  });
});
