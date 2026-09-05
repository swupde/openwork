const allImages = [
  "openwork-den-api",
  "openwork-den-web",
  "openwork-inference",
  "openwork-den-gateway",
]
const sharedPrefixes = [
  "patches/",
  "packages/types/",
  "ee/packages/utils/",
]
const noImagePrefixes = [
  "docs/",
  "packaging/helm/openwork-ee/",
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
    if (noImagePrefixes.some((prefix) => changedFile.startsWith(prefix))) continue
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
