import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflowPaths = [
  ".github/workflows/ci-tests.yml",
  ".github/workflows/ci-enterprise-mcp-mock.yml",
  ".github/workflows/den-db-check.yml",
  ".github/workflows/ci-i18n.yml",
]
const expectedConcurrency = [
  "concurrency:",
  "group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
  "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
]

test("PR validation workflows cancel superseded runs without cancelling branch pushes", async () => {
  for (const workflowPath of workflowPaths) {
    const workflow = await readFile(path.join(repoRoot, workflowPath), "utf8")
    assert.equal((workflow.match(/^concurrency:$/gm) || []).length, 1, `${workflowPath} must have one concurrency mapping`)
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
  assert.match(workflow, /core\.setOutput\("images", JSON\.stringify\(images\)\)/)
  assert.match(workflow, /image: \$\{\{ fromJSON\(needs\.classify-ee-images\.outputs\.images\) \}\}/)
  assert.match(workflow, /- "scripts\/ci\/select-ee-images\.mjs"/)
  assert.doesNotMatch(workflow, /matrix\.(dockerfile|port|health_path|smoke_env)/)
})


test("only retained fork workflows can run; optional job guards remain valid YAML", async () => {
  const require = createRequire(path.join(repoRoot, "apps/server/package.json"))
  const { parse } = require("yaml")
  const retained = new Set([
    "ci-tests.yml", "ci-enterprise-mcp-mock.yml", "den-db-check.yml",
    "ci-i18n.yml", "ci-no-new-eval-flows.yml", "publish-ee-images.yml",
  ])
  const directory = path.join(repoRoot, ".github/workflows")
  for (const name of (await readdir(directory)).filter((entry) => /\.ya?ml$/.test(entry))) {
    const workflow = parse(await readFile(path.join(directory, name), "utf8"))
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      if (retained.has(name)) {
        assert.ok(!JSON.stringify(job["runs-on"]).includes("blacksmith"), `${name}:${jobName} requires a GitHub-hosted runner`)
      } else {
        assert.match(String(job.if ?? ""), /github\.repository == 'different-ai\/openwork'/, `${name}:${jobName} must remain upstream-only`)
      }
    }
  }
})


test("fork-test MySQL does not occupy the native security suite's port", async () => {
  const require = createRequire(path.join(repoRoot, "apps/server/package.json"))
  const { parse } = require("yaml")
  const workflow = parse(await readFile(path.join(repoRoot, ".github/workflows/ci-tests.yml"), "utf8"))
  const native = parse(await readFile(path.join(repoRoot, "packaging/docker/docker-compose.web-local.yml"), "utf8"))
  const unit = workflow.jobs["openwork-tests-core"]
  const hostPorts = (ports) => ports.map((port) => String(port).split(":").at(-2))
  const forkPorts = hostPorts(unit.services.mysql.ports)
  const nativePorts = hostPorts(native.services.mysql.ports)
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (!job.services?.mysql || !job.env?.DATABASE_URL) continue
    assert.ok(hostPorts(job.services.mysql.ports).includes(new URL(job.env.DATABASE_URL).port), `${name} must use its own MySQL service port`)
  }
  for (const port of forkPorts) assert.ok(!nativePorts.includes(port), `Both MySQL fixtures bind ${port}`)
  for (const name of ["Prepare the throwaway fork-test database", "Run retained fork regressions"]) {
    const step = unit.steps.find((entry) => entry.name === name)
    assert.ok(step, `Missing ${name}`)
    assert.ok(forkPorts.includes(new URL(step.env.DATABASE_URL).port), `${name} must use its isolated service port`)
  }
})
