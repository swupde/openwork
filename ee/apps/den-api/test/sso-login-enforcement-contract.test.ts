import { expect, test } from "bun:test"

const requirementSourcePath = new URL("../src/enterprise-auth-requirement.ts", import.meta.url)

test("only verified SSO providers can require organization sign-in", async () => {
  const source = await Bun.file(requirementSourcePath).text()

  expect(source).toContain("eq(SsoProviderTable.domainVerified, true)")
})
