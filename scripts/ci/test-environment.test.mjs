import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('./run-tests.mjs', import.meta.url))
function fixture(t, mismatch = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fork-env-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'scripts/ci'), { recursive: true })
  mkdirSync(path.join(root, 'bin'))
  writeFileSync(path.join(root, 'scripts/ci/test-environment.json'), JSON.stringify({ node: process.versions.node, bun: '1.3.14', timezone: 'UTC' }))
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.4.0' }))
  writeFileSync(path.join(root, 'constants.json'), JSON.stringify({ opencodeVersion: 'v1.18.30' }))
  for (const [name, version] of Object.entries({ node: process.versions.node, pnpm: '11.4.0', bun: '1.3.14', opencode: '1.18.30', ...mismatch })) {
    writeFileSync(path.join(root, 'bin', name), `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o755 })
  }
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(git('init', '-q').status, 0)
  git('add', '.')
  assert.equal(git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture').status, 0)
  const receipt = path.join(root, '.git', 'receipt.json')
  const run = (...args) => spawnSync(process.execPath, [entry, '--evidence', receipt, '--', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, TZ: 'Europe/Berlin' } })
  return { root, run, git, receipt }
}

test('verified entry refuses mismatched tools before dispatching a test', (t) => {
  for (const [name, version] of Object.entries({ node: '0.0.0', pnpm: '10.0.0', bun: '1.3.13', opencode: '1.2.26' })) {
    const f = fixture(t, { [name]: version })
    const result = f.run(process.execPath, '-e', 'process.stdout.write("SHOULD_NOT_RUN")')
    assert.notEqual(result.status, 0, name)
    assert.match(result.stderr, new RegExp(`Environment mismatch: ${name}`))
    assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/)
  }
})

test('verified entry forces UTC and preserves command arguments and failure status', (t) => {
  const f = fixture(t)
  const result = f.run(process.execPath, '-e', 'console.log(process.env.TZ, JSON.stringify(process.argv.slice(1))); process.exit(7)', 'a b', 'literal;$value')
  assert.equal(result.status, 7, result.stderr)
  assert.match(result.stdout, /UTC \["a b","literal;\$value"\]/)
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'))
  assert.equal(receipt.exitCode, 7)
  assert.equal(receipt.kind, 'local-command')
  assert.equal(receipt.timezone, 'UTC')
})

test('evidence binds exact commit/tree and dirty state without arguments, environment or paths', (t) => {
  const f = fixture(t)
  const secret = 'private-fixture-argument'
  const result = f.run(process.execPath, '-e', 'process.exit(0)', secret)
  assert.equal(result.status, 0, result.stderr)
  const raw = readFileSync(f.receipt, 'utf8')
  const receipt = JSON.parse(raw)
  assert.equal(receipt.source.commit, f.git('rev-parse', 'HEAD').stdout.trim())
  assert.equal(receipt.source.tree, f.git('rev-parse', 'HEAD^{tree}').stdout.trim())
  assert.equal(receipt.source.dirty, false)
  assert.equal(receipt.sourceUnchanged, true)
  assert.match(receipt.commandDigest, /^sha256:[a-f0-9]{64}$/)
  assert.doesNotMatch(raw, new RegExp(secret))
  assert.ok(!raw.includes(f.root))
  assert.equal(Object.hasOwn(receipt, 'env'), false)
  assert.equal(Object.hasOwn(receipt, 'argv'), false)
  writeFileSync(path.join(f.root, 'new-source.txt'), 'different source')
  assert.equal(f.run(process.execPath, '-e', 'process.exit(0)').status, 0)
  assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).source.dirty, true)
})

test('evidence detects source edited during a successful command', (t) => {
  const f = fixture(t)
  assert.equal(f.run(process.execPath, '-e', 'require("node:fs").writeFileSync("new-source.txt", "changed")').status, 0)
  assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).sourceUnchanged, false)
})

test('evidence refuses a tracked or unignored operator destination', (t) => {
  const f = fixture(t)
  const result = spawnSync(process.execPath, [entry, '--evidence', path.join(f.root, 'public-receipt.json'), '--check'], { cwd: f.root, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Evidence destination must be Git metadata or ignored/)
})

test('GitHub setup resolves package and engine pins from their existing canonical sources', (t) => {
  const f = fixture(t)
  const output = path.join(f.root, '.git', 'outputs')
  const envFile = path.join(f.root, '.git', 'environment')
  writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.5.0' }))
  writeFileSync(path.join(f.root, 'constants.json'), JSON.stringify({ opencodeVersion: 'v9.8.7' }))
  const resolver = fileURLToPath(new URL('./test-environment.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [resolver, '--github-output'], { cwd: f.root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_ENV: envFile } })
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(output, 'utf8'), /^pnpm=11\.5\.0$/m)
  assert.match(readFileSync(output, 'utf8'), /^opencode=9\.8\.7$/m)
  assert.equal(readFileSync(envFile, 'utf8'), 'TZ=UTC\n')
})

test('retained CI consumers share the contract and immutable runtime setup actions', async () => {
  const { createRequire } = await import('node:module')
  const repo = path.resolve(path.dirname(entry), '../..')
  const require = createRequire(path.join(repo, 'apps/server/package.json'))
  const { parse } = require('yaml')
  const setup = parse(readFileSync(path.join(repo, '.github/actions/setup-test-runtimes/action.yml'), 'utf8'))
  const expectedOutputs = new Map([['actions/setup-node', 'node-version'], ['pnpm/action-setup', 'version'], ['oven-sh/setup-bun', 'bun-version']])
  for (const [action, key] of expectedOutputs) {
    const step = setup.runs.steps.find((s) => s.uses?.startsWith(action + '@'))
    assert.match(step.uses, /@[a-f0-9]{40}$/)
    assert.match(step.with[key], /^\$\{\{ steps\.contract\.outputs\.(node|pnpm|bun) \}\}$/)
  }
  const targets = ['.github/actions/setup-tests/action.yml', ...['ci-tests', 'ci-enterprise-mcp-mock', 'den-db-check', 'ci-i18n'].map((name) => `.github/workflows/${name}.yml`)]
  for (const target of targets) {
    const value = parse(readFileSync(path.join(repo, target), 'utf8'))
    const steps = value.runs?.steps ?? Object.values(value.jobs).flatMap((job) => job.steps ?? [])
    assert.ok(steps.some((step) => ['./.github/actions/setup-tests', './.github/actions/setup-test-runtimes'].includes(step.uses)), target)
    assert.ok(!steps.some((step) => [...expectedOutputs.keys()].some((name) => step.uses?.startsWith(name + '@'))), `${target} duplicates runtime installation`)
  }
})
