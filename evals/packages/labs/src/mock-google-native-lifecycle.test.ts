import { expect, test } from "vitest";
import { startMockGoogleServer } from "./mock-google-server.ts";

async function client(nativeFileLifecycle = false) {
  const google = await startMockGoogleServer({ accounts: ["native@example.test"], port: 0, autoApprove: true, nativeFileLifecycle });
  try {
    const authorize = new URL(`${google.baseUrl}/authorize`);
    for (const [key, value] of Object.entries({ client_id: "fixture", response_type: "code", redirect_uri: "http://127.0.0.1:1/callback", scope: "openid https://www.googleapis.com/auth/drive.file", state: "fixture" })) authorize.searchParams.set(key, value);
    const approval = await fetch(authorize, { redirect: "manual" });
    const code = new URL(approval.headers.get("location") ?? "").searchParams.get("code");
    if (!code) throw new Error("Synthetic Google approval did not issue a code.");
    const tokenResponse = await fetch(`${google.baseUrl}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: "fixture", client_secret: "fixture" }) });
    const token = await tokenResponse.json() as { access_token: string };
    return {
      async request(path: string, method = "GET", body?: unknown) {
        const response = await fetch(`${google.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      },
      close: () => google.stop(),
    };
  } catch (error) { await google.stop(); throw error; }
}

test("the default Google fixture retains its service-action spreadsheet witness", async () => {
  const google = await client();
  try {
    const result = await google.request("/v4/spreadsheets", "POST", { properties: { title: "Default witness" }, sheets: [{ properties: { title: "Sheet1" } }] });
    expect(result).toMatchObject({ status: 200, body: { spreadsheetId: "sheet-1" } });
    expect(await google.request("/v4/spreadsheets/sheet-1")).toMatchObject({ status: 200, body: { properties: { title: "Default witness" } } });
  } finally { await google.close(); }
});

test("native file lifecycle mode keeps created Docs, Sheets and Slides in the same mutable provider store", async () => {
  const google = await client(true);
  try {
    for (const item of [
      { path: "/v1/documents", idKey: "documentId", body: { title: "Native document" } },
      { path: "/v4/spreadsheets", idKey: "spreadsheetId", body: { properties: { title: "Native sheet" }, sheets: [{ properties: { title: "Summary" } }] } },
      { path: "/v1/presentations", idKey: "presentationId", body: { title: "Native slides" } },
    ]) {
      const created = await google.request(item.path, "POST", item.body);
      expect(created.status).toBe(200);
      const id = String(created.body[item.idKey]);
      expect(id).toMatch(/^native_/);
      expect((await google.request(`${item.path}/${id}`)).status).toBe(200);
      expect((await google.request(`${item.path}/${id}:batchUpdate`, "POST", { requests: [] })).status).toBe(200);
      if (item.idKey === "spreadsheetId") {
        expect((await google.request(`${item.path}/${id}/values/Summary!A1:clear`, "POST", {})).status).toBe(200);
        expect((await google.request(`${item.path}/${id}/values/Summary!A1`, "PUT", { values: [["Revenue", 42]] })).status).toBe(200);
      }
      expect(await google.request(`/drive/v3/files/${id}`)).toMatchObject({ status: 200, body: { id } });
      expect(await google.request(`/drive/v3/files/${id}`, "PATCH", { name: "Replacement" })).toMatchObject({ status: 200, body: { id, name: "Replacement" } });
    }
  } finally { await google.close(); }
});
