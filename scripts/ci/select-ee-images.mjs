const imageConfigs = {
  "openwork-den-api": {
    image: "openwork-den-api",
    dockerfile: "packaging/docker/Dockerfile.den",
    port: 8788,
    health_path: "/health",
    smoke_env: [
      "-e DB_MODE=mysql",
      "-e DEN_DB_ENCRYPTION_KEY=ci-den-db-encryption-key-value-123456",
      "-e BETTER_AUTH_SECRET=ci-better-auth-secret-value-123456",
      "-e BETTER_AUTH_URL=http://127.0.0.1:8788",
    ].join(" "),
  },
  "openwork-den-web": {
    image: "openwork-den-web",
    dockerfile: "packaging/docker/Dockerfile.den-web",
    port: 3005,
    health_path: "/api/health",
    smoke_env: "",
  },
  "openwork-inference": {
    image: "openwork-inference",
    dockerfile: "packaging/docker/Dockerfile.inference",
    port: 8791,
    health_path: "/health",
    smoke_env: [
      "-e DB_MODE=mysql",
      "-e DATABASE_URL=mysql://smoke:smoke@127.0.0.1:3306/smoke",
      "-e DEN_DB_ENCRYPTION_KEY=ci-den-db-encryption-key-value-123456",
    ].join(" "),
  },
  "openwork-den-gateway": {
    image: "openwork-den-gateway",
    dockerfile: "packaging/docker/Dockerfile.den-gateway",
    port: 8788,
    health_path: "/__gw/health",
    smoke_env: [
      "-e DEN_API_BASE=http://127.0.0.1:9",
      "-e DEN_GATEWAY_KEY=ci-den-gateway-key-value-123456",
    ].join(" "),
  },
}

const allImages = Object.keys(imageConfigs)
const sharedPrefixes = [
  "patches/",
  "packages/types/",
  "ee/packages/utils/",
]
const directPrefixes = [
  ["ee/apps/den-api/", ["openwork-den-api"]],
  ["ee/apps/den-web/", ["openwork-den-web"]],
  ["ee/apps/inference/", ["openwork-inference"]],
  ["ee/apps/den-gateway/", ["openwork-den-gateway"]],
  ["apps/app/", ["openwork-den-gateway"]],
  ["packages/ui/", ["openwork-den-web", "openwork-den-gateway"]],
  ["packages/install-config/", ["openwork-den-gateway"]],
  ["packages/paths/", ["openwork-den-api"]],
  ["packages/automations/", ["openwork-den-api"]],
  ["packages/codemode/", ["openwork-den-api"]],
  ["packages/connect-link/", ["openwork-den-api"]],
  ["packages/email/", ["openwork-den-api"]],
  ["packages/enterprise-mcp-client/", ["openwork-den-api"]],
  ["packages/headless-threads/", ["openwork-den-api"]],
  ["packages/mcp-apps/", ["openwork-den-api"]],
  ["ee/packages/den-db/", ["openwork-den-api", "openwork-inference"]],
  ["ee/packages/telemetry-contracts/", ["openwork-den-api", "openwork-den-web"]],
  ["ee/packages/telemetry/", ["openwork-den-api"]],
  ["packaging/docker/Dockerfile.den", ["openwork-den-api"], true],
  ["packaging/docker/Dockerfile.den-web", ["openwork-den-web"], true],
  ["packaging/docker/Dockerfile.inference", ["openwork-inference"], true],
  ["packaging/docker/Dockerfile.den-gateway", ["openwork-den-gateway"], true],
]
const sharedFiles = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".github/workflows/publish-ee-images.yml",
])

export function selectEeImages(changedFiles) {
  if (changedFiles.length === 0) return allImages

  const selected = new Set()

  for (const changedFile of changedFiles) {
    if (changedFile.startsWith("packaging/helm/openwork-ee/")) continue
    if (sharedFiles.has(changedFile) || sharedPrefixes.some((prefix) => changedFile.startsWith(prefix))) {
      return allImages
    }

    const match = directPrefixes.find(([prefix, , exact]) => (
      exact ? changedFile === prefix : changedFile.startsWith(prefix)
    ))
    if (!match) return allImages
    for (const image of match[1]) selected.add(image)
  }

  return allImages.filter((image) => selected.has(image))
}

export function selectEeImageMatrix(changedFiles) {
  return {
    include: selectEeImages(changedFiles).map((image) => imageConfigs[image]),
  }
}
