import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const folder = new URL('../drizzle/', import.meta.url)
const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', folder), 'utf8'))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

test('deployed 102-migration prefix keeps its original SQL and receipt identities', () => {
  const rows = journal.entries.slice(0, 102).map((entry) => [
    entry.idx, entry.tag, entry.when,
    sha256(readFileSync(new URL(`${entry.tag}.sql`, folder))),
  ])
  assert.equal(sha256(JSON.stringify(rows)), '504e7b8daf1a259dd2fb01d9027c6d6a8a7524a39959cea0d3b06cb6f6a8aff9')
})

test('deployed 122-migration prefix keeps its original SQL and receipt identities', () => {
  const rows = journal.entries.slice(0, 122).map((entry) => [
    entry.idx, entry.tag, entry.when,
    sha256(readFileSync(new URL(`${entry.tag}.sql`, folder))),
  ])
  assert.equal(sha256(JSON.stringify(rows)), 'c44203541ba6d63bb5bb46528be82ba094702ab4353c19eef6664b42f914a1a6')
})

test('deployed 142-migration prefix keeps its original SQL and receipt identities', () => {
  const rows = journal.entries.slice(0, 142).map((entry) => [
    entry.idx, entry.tag, entry.when,
    sha256(readFileSync(new URL(`${entry.tag}.sql`, folder))),
  ])
  assert.equal(sha256(JSON.stringify(rows)), '2e6a99a62716d2066c4d91715ce788276187b80f23570bc608bbc6558c470438')
})

test('v0.18.59 migrations follow the deployed 142 receipts', () => {
  assert.equal(journal.entries.length, 152)
  assert.equal(journal.entries[142].tag, '0143_secret_bruce_banner')
  assert.equal(journal.entries[151].tag, '0152_desktop_startup_report')
  assert.equal(journal.entries.filter((entry) => entry.when > journal.entries[141].when).length, 10)
})

test('new release migrations follow the deployed 122 receipts', () => {
  assert.equal(journal.entries.slice(0, 142).length, 142)
  assert.equal(journal.entries[122].tag, '0123_remote_session_targets')
  assert.equal(journal.entries[141].tag, '0142_salty_captain_midlands')
  assert.ok(journal.entries[122].when > journal.entries[121].when)
})

test('all imported migrations remain pending after the deployed fork receipt', () => {
  const deployedTimestamp = 1789840546329
  const pending = journal.entries.filter((entry) => entry.when > deployedTimestamp)
  assert.equal(pending.length, journal.entries.length - 102)
  assert.equal(pending[0].tag, '0103_gateway_usage_limits')
  assert.equal(pending[19].tag, '0122_slack_desktop_handoff')
  for (const [index, entry] of journal.entries.entries()) {
    assert.equal(entry.idx, index + 1)
    assert.equal(Number(entry.tag.slice(0, 4)), entry.idx)
    if (index) assert.ok(entry.when > journal.entries[index - 1].when)
    assert.ok(readFileSync(new URL(`${entry.tag}.sql`, folder)).length)
  }
})

test('imported snapshot chain preserves pending OAuth account semantics', () => {
  let previous = JSON.parse(readFileSync(new URL('meta/0102_snapshot.json', folder), 'utf8'))
  for (const entry of journal.entries.slice(102)) {
    const current = JSON.parse(readFileSync(new URL(`meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`, folder), 'utf8'))
    assert.equal(current.prevId, previous.id)
    const connected = current.tables.connected_account.columns.connected_at
    assert.equal(connected.notNull, false)
    assert.equal(connected.default, undefined)
    previous = current
  }
})
