import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflowPaths = [
  ".github/workflows/ci-tests.yml",
  ".github/workflows/ci-enterprise-mcp-mock.yml",
  ".github/workflows/den-db-check.yml",
  ".github/workflows/ci-i18n.yml",
  ".github/workflows/spec-impact.yml",
]
const expectedConcurrency = [
  "concurrency:",
  "group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
  "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
]

test("PR validation workflows cancel superseded runs without cancelling branch pushes", async () => {
  for (const workflowPath of workflowPaths) {
    const workflow = await readFile(path.join(repoRoot, workflowPath), "utf8")
    for (const line of expectedConcurrency) {
      assert.ok(workflow.includes(line), `${workflowPath} is missing ${line}`)
    }
  }
})

test("artifact workflow derives its image matrix from changed files", async () => {
  const workflow = await readFile(
    path.join(repoRoot, ".github/workflows/publish-ee-images.yml"),
    "utf8",
  )

  assert.match(workflow, /classify-ee-images:/)
  assert.match(workflow, /fromJSON\(needs\.classify-ee-images\.outputs\.matrix\)/)
  assert.match(workflow, /- "scripts\/ci\/select-ee-images\.mjs"/)
})
