#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, lstatSync, readlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import { testEnvironment } from './test-environment.mjs'

const root = process.cwd()
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  if (result.status !== 0) throw new Error('Test evidence requires a Git checkout')
  return result.stdout
}
function sourceIdentity() {
  const tracked = git('diff', '--binary', 'HEAD')
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort()
  const hash = createHash('sha256').update(tracked)
  for (const file of untracked) {
    const absolute = path.join(root, file)
    hash.update(file).update('\0').update(lstatSync(absolute).isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute)).update('\0')
  }
  return { commit: git('rev-parse', 'HEAD').trim(), tree: git('rev-parse', 'HEAD^{tree}').trim(), dirty: Boolean(git('status', '--porcelain').trim()), workingChangesDigest: `sha256:${hash.digest('hex')}` }
}
const args = process.argv.slice(2)
let evidence
if (args[0] === '--evidence') { args.shift(); evidence = args.shift(); if (!evidence) throw new Error('Missing evidence destination') }
const checkOnly = args[0] === '--check'
if (checkOnly) args.shift()
if (args[0] === '--') args.shift()
if (!checkOnly && !args.length) throw new Error('Usage: pnpm test:verified -- <existing test command and arguments>')
const source = sourceIdentity()
const destination = evidence ?? path.resolve(root, git('rev-parse', '--git-path', `swup-test-evidence/${randomUUID()}.json`).trim())
function canonicalPath(input) {
  let parent = path.resolve(input)
  const suffix = []
  while (!existsSync(parent)) { suffix.unshift(path.basename(parent)); parent = path.dirname(parent) }
  return path.join(realpathSync(parent), ...suffix)
}
const absoluteDestination = canonicalPath(destination)
const gitDirectory = canonicalPath(git('rev-parse', '--absolute-git-dir').trim())
const relativeToGit = path.relative(gitDirectory, absoluteDestination)
const inGit = relativeToGit !== '' && !relativeToGit.startsWith('..') && !path.isAbsolute(relativeToGit)
const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', absoluteDestination], { cwd: root }).status === 0
if (!inGit && !ignored) throw new Error('Evidence destination must be Git metadata or ignored operator output')
const receipt = { kind: 'local-command', source, commandDigest: digest(JSON.stringify(args)), program: ['node', 'pnpm', 'bun', 'opencode'].includes(path.basename(args[0] ?? '')) ? path.basename(args[0]) : 'custom', startedAt: new Date().toISOString(), outcome: 'environment-refused' }
let exitCode = 1
try {
  const contract = testEnvironment(root)
  receipt.expectedVersions = contract.versions
  receipt.timezone = contract.timezone
  const env = { ...process.env, TZ: contract.timezone }
  const versions = {}
  for (const [name, expected] of Object.entries(contract.versions)) {
    const actual = spawnSync(name, ['--version'], { cwd: root, env, encoding: 'utf8', timeout: 15_000 })
    const version = actual.stdout?.trim().replace(/^v/, '')
    if (actual.status !== 0 || version !== expected || (name === 'node' && process.versions.node !== expected)) throw new Error(`Environment mismatch: ${name}; use the versions from scripts/ci/test-environment.mjs`)
    versions[name] = version
  }
  receipt.versions = versions
  receipt.outcome = checkOnly ? 'environment-checked' : 'command-finished'
  const result = checkOnly ? { status: 0 } : spawnSync(args[0], args.slice(1), { cwd: root, env, stdio: 'inherit' })
  exitCode = result.status ?? (result.signal ? 128 + (constants.signals[result.signal] ?? 0) : 127)
} catch (error) {
  console.error(error.message)
} finally {
  receipt.exitCode = exitCode
  receipt.finishedAt = new Date().toISOString()
  receipt.sourceAfter = sourceIdentity()
  receipt.sourceUnchanged = JSON.stringify(source) === JSON.stringify(receipt.sourceAfter)
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  writeFileSync(destination, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
  chmodSync(destination, 0o600)
  console.error(`Local test evidence recorded (${receipt.outcome}, exit ${exitCode}); this is not CI evidence.`)
}
process.exitCode = exitCode
