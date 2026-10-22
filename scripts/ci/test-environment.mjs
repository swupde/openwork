import { readFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// pnpm and OpenCode retain their existing canonical product/package pins.
export function testEnvironment(root) {
  const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))
  const contract = read('scripts/ci/test-environment.json')
  const packageManager = read('package.json').packageManager
  const opencode = read('constants.json').opencodeVersion?.replace(/^v/, '')
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageManager ?? '')) throw new Error('Expected exact pnpm packageManager pin')
  const versions = { node: contract.node, pnpm: packageManager.slice(5), bun: contract.bun, opencode }
  for (const [name, value] of Object.entries(versions)) {
    if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) throw new Error(`Expected exact ${name} pin`)
  }
  if (contract.timezone !== 'UTC') throw new Error('Test timezone must be UTC')
  return { versions, timezone: contract.timezone }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contract = testEnvironment(process.cwd())
  if (process.argv[2] === '--github-output') {
    if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_ENV) throw new Error('GitHub output files are required')
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(contract.versions).map(([k, v]) => `${k}=${v}\n`).join(''))
    appendFileSync(process.env.GITHUB_ENV, `TZ=${contract.timezone}\n`)
  } else {
    console.log(JSON.stringify(contract, null, 2))
  }
}
