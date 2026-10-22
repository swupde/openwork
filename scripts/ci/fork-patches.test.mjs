import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const moduleUrl = new URL('./fork-patches.mjs', import.meta.url)
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'fork-audit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
  git('init', '-q')
  for (const file of ['runtime.txt', 'removed.txt']) writeFileSync(path.join(root, file), 'upstream\n')
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'upstream')
  return { root, git, upstream: git('rev-parse', 'HEAD') }
}
const patch = (paths) => ({ id: 'example-contract', purpose: 'Keep the demonstrated boundary', paths, behavior: 'Fixture-only boundary', regressionTests: ['fixture.test.mjs'], retirementCondition: 'Upstream behavior and negative tests match', upstreamEquivalence: 'not equivalent', status: 'retained' })

test('audit rejects unclassified tracked and untracked drift, including deletions', async (t) => {
  const { auditFork } = await import(moduleUrl)
  const f = fixture(t)
  writeFileSync(path.join(f.root, 'runtime.txt'), 'fork\n')
  rmSync(path.join(f.root, 'removed.txt'))
  writeFileSync(path.join(f.root, 'new.txt'), 'new\n')
  const result = auditFork(f.root, { upstream: f.upstream, patches: [patch(['runtime.txt'])] })
  assert.deepEqual(result.unclassified, ['new.txt', 'removed.txt'])
  assert.equal(result.ok, false)
})

test('audit accepts explicit complete coverage and refuses stale or duplicate declarations', async (t) => {
  const { auditFork } = await import(moduleUrl)
  const f = fixture(t)
  writeFileSync(path.join(f.root, 'runtime.txt'), 'fork\n')
  const complete = auditFork(f.root, { upstream: f.upstream, patches: [patch(['runtime.txt'])] })
  assert.equal(complete.ok, true)
  assert.equal(complete.changedPaths, 1)
  assert.deepEqual(auditFork(f.root, { upstream: f.upstream, patches: [patch(['runtime.txt', 'removed.txt'])] }).stale, ['removed.txt'])
  assert.throws(() => auditFork(f.root, { upstream: f.upstream, patches: [patch(['runtime.txt']), { ...patch(['runtime.txt']), id: 'duplicate' }] }), /Multiple patches classify/)
})

test('audit requires meaningful retirement and regression contracts for every patch', async (t) => {
  const { auditFork } = await import(moduleUrl)
  const f = fixture(t)
  assert.throws(() => auditFork(f.root, { upstream: f.upstream, patches: [{ ...patch(['runtime.txt']), retirementCondition: '' }] }), /retirementCondition/)
  assert.throws(() => auditFork(f.root, { upstream: f.upstream, patches: [{ ...patch(['runtime.txt']), regressionTests: [] }] }), /regressionTests/)
})

test('native default-model declarations cannot acquire a local runtime patch silently', async (t) => {
  const { auditFork } = await import(moduleUrl)
  const f = fixture(t)
  writeFileSync(path.join(f.root, 'runtime.txt'), 'custom default\n')
  const result = auditFork(f.root, { upstream: f.upstream, patches: [patch(['runtime.txt'])], upstreamNative: [{ id: 'native-default', paths: ['runtime.txt'] }] })
  assert.equal(result.ok, false)
  assert.deepEqual(result.nativeDrift, ['runtime.txt'])
})
