import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptPath = fileURLToPath(new URL("./select-ee-images.mjs", import.meta.url))
const classifier = existsSync(scriptPath)
  ? await import(pathToFileURL(scriptPath).href)
  : {}

const allImages = [
  "openwork-den-api",
  "openwork-den-web",
  "openwork-inference",
  "openwork-den-gateway",
]

test("selects only the Den API image for a Den API source change", () => {
  assert.deepEqual(
    classifier.selectEeImages?.(["ee/apps/den-api/src/main.ts"]),
    ["openwork-den-api"],
  )
})

test("selects every image when a shared build input changes", () => {
  assert.deepEqual(
    classifier.selectEeImages?.(["packages/types/src/index.ts"]),
    allImages,
  )
})

test("does not build an image for a Helm-only change", () => {
  assert.deepEqual(
    classifier.selectEeImages?.(["packaging/helm/openwork-ee/values.yaml"]),
    [],
  )
})

test("selects only the gateway image when its Dockerfile changes", () => {
  assert.deepEqual(
    classifier.selectEeImages?.(["packaging/docker/Dockerfile.den-gateway"]),
    ["openwork-den-gateway"],
  )
})

test("selects every image when a changed path is not classified", () => {
  assert.deepEqual(
    classifier.selectEeImages?.(["new-unclassified-file.ts"]),
    allImages,
  )
})

test("returns the build metadata required by the GitHub matrix", () => {
  assert.deepEqual(
    classifier.selectEeImageMatrix?.(["ee/apps/den-web/app/page.tsx"]),
    {
      include: [{
        image: "openwork-den-web",
        dockerfile: "packaging/docker/Dockerfile.den-web",
        port: 3005,
        health_path: "/api/health",
        smoke_env: "",
      }],
    },
  )
})
