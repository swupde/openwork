/** Non-authentication regressions still need the public token constants at import time. */
export function createMockDenAuth() {
  const resource = "http://127.0.0.1:8790/mcp/agent"
  const firstPartyResources = ["http://127.0.0.1:8790/mcp"]
  return {
    auth: {},
    // App registration checks these always-refused routes even in non-auth tests.
    getRawBetterAuthMutationDenial: (path: string) => {
      if (["/organization/create-role", "/organization/update-role", "/organization/delete-role"].includes(path)) {
        return { error: "forbidden", message: "Custom organization roles are not supported." }
      }
      throw new Error("Unexpected raw auth mutation path in non-authentication fixture")
    },
    normalizeMcpOAuthResource: (value: string) => {
      const normalized = value.replace(/\/+$/, "")
      return normalized === resource || firstPartyResources.includes(normalized) ? resource : null
    },
    DEN_MCP_OPAQUE_ACCESS_TOKEN_PREFIX: "ow_mcp_at_",
    DEN_MCP_FIRST_PARTY_CLIENT_ID: "openwork-desktop",
    DEN_MCP_FIRST_PARTY_RESOURCES: firstPartyResources,
    DEN_MCP_GRANT_ID_CLAIM: "https://openworklabs.com/grant_id",
    DEN_MCP_ORG_ID_CLAIM: "https://openworklabs.com/org_id",
    DEN_MCP_OAUTH_RESOURCE: resource,
    DEN_MCP_RESOURCE: "http://127.0.0.1:8790/mcp",
    DEN_MCP_RESOURCE_CLAIM: "https://openworklabs.com/resource",
    DEN_MCP_TOKEN_USE_CLAIM: "https://openworklabs.com/token_use",
  }
}
