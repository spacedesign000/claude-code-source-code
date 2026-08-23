import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  createPolicyReport,
  parsePolicyArgs,
  PolicyUsageError,
  validatePolicy,
} from './policy-lib.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const defaultPolicyPath = resolve(projectRoot, 'config', 'policies', 'default.json')

async function readDefaultPolicy() {
  return JSON.parse(await readFile(defaultPolicyPath, 'utf8'))
}

test('default policy satisfies the contract and baseline invariants', async () => {
  const policy = await readDefaultPolicy()
  const result = validatePolicy(policy)

  assert.equal(result.valid, true)
  assert.deepEqual(result.profiles, ['autonomous', 'balanced', 'safe'])
  assert.equal(result.summary.errors, 0)
  assert.ok(result.summary.warnings >= 1)
})

test('defaultProfile must reference a declared profile', async () => {
  const policy = await readDefaultPolicy()
  policy.defaultProfile = 'missing-profile'
  const result = validatePolicy(policy)

  assert.equal(result.valid, false)
  assert.ok(result.errors.some(issue => issue.code === 'unknown-default-profile'))
})

test('credential and repository guards are mandatory', async () => {
  const policy = await readDefaultPolicy()
  policy.profiles.safe.filesystem.deny = ['README.md']
  const result = validatePolicy(policy)

  assert.equal(result.valid, false)
  assert.ok(result.errors.some(issue => issue.code === 'missing-env-guard'))
  assert.ok(result.errors.some(issue => issue.code === 'missing-git-guard'))
  assert.ok(result.errors.some(issue => issue.code === 'missing-ssh-guard'))
})

test('unknown properties are rejected for forward-safe parsing', async () => {
  const policy = await readDefaultPolicy()
  policy.profiles.safe.network.secretBypass = true
  const result = validatePolicy(policy)

  assert.equal(result.valid, false)
  assert.ok(result.errors.some(issue => issue.code === 'unknown-key'))
})

test('private network ranges cannot be enabled', async () => {
  const policy = await readDefaultPolicy()
  policy.profiles.balanced.network.denyPrivateRanges = false
  const result = validatePolicy(policy)

  assert.equal(result.valid, false)
  assert.ok(result.errors.some(issue => issue.code === 'private-network-not-denied'))
})

test('argument parser resolves the default policy and output path', () => {
  const options = parsePolicyArgs(['--json', '--root', 'repo', '--output=reports/policy.json'], {
    cwd: '/workspace',
  })

  assert.equal(options.json, true)
  assert.equal(options.root, '/workspace/repo')
  assert.equal(options.policyPath, '/workspace/repo/config/policies/default.json')
  assert.equal(options.output, '/workspace/reports/policy.json')
})

test('argument parser rejects multiple policy files', () => {
  assert.throws(
    () => parsePolicyArgs(['first.json', 'second.json']),
    PolicyUsageError,
  )
})

test('policy reports expose paths and findings, not policy contents', async () => {
  const report = await createPolicyReport({
    policyPath: defaultPolicyPath,
    root: projectRoot,
    now: () => new Date('2026-08-23T12:00:00.000Z'),
  })
  const serialized = JSON.stringify(report)

  assert.equal(report.valid, true)
  assert.equal(report.policyFile, 'config/policies/default.json')
  assert.equal(report.generatedAt, '2026-08-23T12:00:00.000Z')
  assert.equal(serialized.includes('api.anthropic.com'), false)
  assert.equal(serialized.includes('git push --force'), false)
})
