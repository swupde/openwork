import { afterEach, describe, expect, test } from "bun:test";

import { requestJson } from "../app/(den)/_lib/den-flow.ts";

const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previousWindow;
  }
});

describe("Den flow stale session cleanup", () => {
  test("loads a prefixed runtime API URL before checking and clearing a stale session", async () => {
    globalThis.window = {
      location: { origin: "https://app.openworklabs.com" },
      localStorage: { getItem: () => null },
    };
    const calls = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), credentials: init?.credentials, method: init?.method });
      if (String(input) === "/api/runtime-config") {
        return new Response(JSON.stringify({ denApiUrl: "https://app.openworklabs.com/api/den" }), { status: 200 });
      }
      if (String(input) === "https://app.openworklabs.com/api/den/v1/me") {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const { response } = await requestJson("/v1/me", { method: "GET" }, 12000);

    expect(response.status).toBe(401);
    expect(calls).toEqual([
      { input: "/api/runtime-config", credentials: undefined, method: undefined },
      { input: "https://app.openworklabs.com/api/den/v1/me", credentials: "include", method: "GET" },
      { input: "/api/auth/clear-session-cookie", credentials: "include", method: "POST" },
    ]);
  });
});
