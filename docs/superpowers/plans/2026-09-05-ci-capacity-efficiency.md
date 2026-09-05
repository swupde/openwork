# CI Capacity Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep only the newest pull-request validation run and build only the OpenWork EE images whose build contexts changed.

**Architecture:** Each pull-request workflow receives a concurrency group keyed by its PR number and cancels obsolete runs, while branch pushes retain their existing behavior. A small dependency-aware classifier translates changed files into a GitHub Actions matrix; it defaults conservatively to all images whenever a shared build input changes and emits no image entries for Helm-only edits.

**Tech Stack:** GitHub Actions YAML, Node.js ESM, `node:test`.

---

### Task 1: Specify CI efficiency contracts

**Files:**
- Create: `scripts/ci/select-ee-images.test.mjs`
- Create: `scripts/ci/ci-capacity-contract.test.mjs`
- Test: `scripts/ci/select-ee-images.test.mjs`
- Test: `scripts/ci/ci-capacity-contract.test.mjs`

- [x] **Step 1: Write failing image-selection tests**

```js
assert.deepEqual(selectEeImages(["ee/apps/den-api/src/main.ts"]), ["openwork-den-api"])
assert.deepEqual(selectEeImages(["packages/types/src/index.ts"]), allImages)
assert.deepEqual(selectEeImages(["packaging/helm/openwork-ee/values.yaml"]), [])
```

- [x] **Step 2: Write the failing workflow-contract test**

```js
for (const workflow of prWorkflows) {
  assert.match(source, /concurrency:/)
  assert.match(source, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
}
assert.match(publishWorkflow, /classify-ee-images/)
```

- [x] **Step 3: Run tests to verify they fail**

Run: `node --test scripts/ci/select-ee-images.test.mjs scripts/ci/ci-capacity-contract.test.mjs`

Expected: FAIL because the classifier and PR concurrency contract do not exist.

### Task 2: Add the conservative image classifier

**Files:**
- Create: `scripts/ci/select-ee-images.mjs`
- Modify: `.github/workflows/publish-ee-images.yml:49-180`
- Test: `scripts/ci/select-ee-images.test.mjs`

- [x] **Step 1: Implement direct-image and shared-build-input classification**

```js
export function selectEeImages(changedFiles) {
  // Return all images for shared context inputs, direct images for owned source,
  // and no images for Helm-only changes.
}
```

- [x] **Step 2: Use the classifier in a checked-out `classify-ee-images` job**

```yaml
classify-ee-images:
  outputs:
    matrix: ${{ steps.classify.outputs.matrix }}
```

- [x] **Step 3: Feed its output into the image matrix and prevent a Helm-only branch push from redeploying the gateway**

```yaml
matrix: ${{ fromJSON(needs.classify-ee-images.outputs.matrix) }}
```

- [x] **Step 4: Run the image-selection test to verify it passes**

Run: `node --test scripts/ci/select-ee-images.test.mjs`

Expected: PASS.

### Task 3: Cancel superseded pull-request validation runs

**Files:**
- Modify: `.github/workflows/ci-tests.yml:11-17`
- Modify: `.github/workflows/ci-enterprise-mcp-mock.yml:22-28`
- Modify: `.github/workflows/den-db-check.yml:19-25`
- Modify: `.github/workflows/ci-i18n.yml:11-17`
- Modify: `.github/workflows/spec-impact.yml:8-14`
- Test: `scripts/ci/ci-capacity-contract.test.mjs`

- [x] **Step 1: Add a PR-number concurrency group to each workflow**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

- [x] **Step 2: Run the workflow-contract test to verify it passes**

Run: `node --test scripts/ci/ci-capacity-contract.test.mjs`

Expected: PASS.

### Task 4: Verify the complete release contract

**Files:**
- Modify: `docs/superpowers/plans/2026-09-05-ci-capacity-efficiency.md`

- [x] **Step 1: Validate all changed YAML files parse**

Run: `ruby -e 'require "yaml"; ARGV.each { |path| YAML.load_file(path) }' .github/workflows/{ci-tests,ci-enterprise-mcp-mock,den-db-check,ci-i18n,spec-impact,publish-ee-images}.yml`

Expected: exit 0.

- [x] **Step 2: Run both CI contract tests**

Run: `node --test scripts/ci/select-ee-images.test.mjs scripts/ci/ci-capacity-contract.test.mjs`

Expected: all tests pass.

- [x] **Step 3: Review the diff and commit the bounded CI change**

Run: `git diff --check && git diff -- .github/workflows scripts/ci docs/superpowers/plans`

Expected: no whitespace errors; only CI capacity and its test contract change.
