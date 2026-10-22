#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export function auditFork(root, manifest) {
  if (!/^[a-f0-9]{40}$/.test(manifest.upstream ?? '')) throw new Error('Pin a complete upstream commit')
  const owners = new Map()
  const ids = new Set()
  for (const patch of manifest.patches) {
    if (!patch.id || ids.has(patch.id)) throw new Error('Patch ids must be unique')
    ids.add(patch.id)
    for (const key of ['purpose', 'behavior', 'retirementCondition', 'upstreamEquivalence', 'status']) {
      if (typeof patch[key] !== 'string' || !patch[key].trim()) throw new Error(`${patch.id}: missing ${key}`)
    }
    if (!patch.regressionTests?.length) throw new Error(`${patch.id}: missing regressionTests`)
    if (!patch.paths?.length) throw new Error(`${patch.id}: missing explicit paths`)
    for (const file of patch.paths) {
      if (file.startsWith('/') || file.split('/').includes('..') || /[*?]/.test(file)) throw new Error('Use explicit repository paths')
      if (owners.has(file)) throw new Error(`Multiple patches classify ${file}`)
      owners.set(file, patch.id)
    }
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean)
  const changed = new Set([...git('diff', '--name-only', '--no-renames', '-z', manifest.upstream, '--'), ...git('ls-files', '--others', '--exclude-standard', '-z')])
  const unclassified = [...changed].filter((file) => !owners.has(file)).sort()
  const stale = [...owners.keys()].filter((file) => !changed.has(file)).sort()
  const nativeDrift = (manifest.upstreamNative ?? []).flatMap((entry) => entry.paths).filter((file) => changed.has(file)).sort()
  return { ok: !unclassified.length && !stale.length && !nativeDrift.length, nativeDrift, upstream: manifest.upstream, patches: manifest.patches.length, changedPaths: changed.size, unclassified, stale }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd()
  try {
    const result = auditFork(root, JSON.parse(readFileSync(path.join(root, 'docs/swup-fork-patches.json'), 'utf8')))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.ok ? 0 : 1
  } catch (error) {
    console.error(`Fork audit failed: ${error.message}`)
    process.exitCode = 1
  }
}
