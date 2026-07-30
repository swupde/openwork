import { expect, test } from "bun:test"

const authSourcePath = new URL("../src/auth.ts", import.meta.url)

test("SSO domain verification uses the short DNS prefix required by our DNS provider", async () => {
  const source = await Bun.file(authSourcePath).text()
  const ssoPlugin = source.slice(source.indexOf("sso({"), source.indexOf("apiKey({"))

  expect(ssoPlugin).toContain("domainVerification: {")
  expect(ssoPlugin).toContain('tokenPrefix: "ow"')
})
