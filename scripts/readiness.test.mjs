import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  calculateScore,
  CliUsageError,
  formatHumanReport,
  getExitCode,
  parseArgs,
  redactHomePath,
  runReadiness,
  summarizeChecks,
} from './readiness-lib.mjs'

function fakeCommandRunner({
  bunAvailable = true,
  bunVersion = '1.3.14',
  gitAvailable = true,
  insideRepository = true,
  dirty = false,
  statusInspectionOk = true,
  trackedInspectionOk = true,
  trackedEnv = '',
} = {}) {
  return async (command, args) => {
    if (command === 'bun') {
      return bunAvailable
        ? { ok: true, code: 0, stdout: bunVersion, stderr: '' }
        : { ok: false, code: null, stdout: '', stderr: 'not found' }
    }
    if (command !== 'git') {
      return { ok: false, code: null, stdout: '', stderr: 'unknown command' }
    }

    const signature = args.join(' ')
    if (signature === '--version') {
      return gitAvailable
        ? { ok: true, code: 0, stdout: 'git version 2.50.0', stderr: '' }
        : { ok: false, code: null, stdout: '', stderr: 'not found' }
    }
    if (!gitAvailable) {
      return { ok: false, code: null, stdout: '', stderr: 'not found' }
    }
    if (signature === 'rev-parse --is-inside-work-tree') {
      return insideRepository
        ? { ok: true, code: 0, stdout: 'true', stderr: '' }
        : { ok: false, code: 128, stdout: '', stderr: 'not a repository' }
    }
    if (signature === 'rev-parse --abbrev-ref HEAD') {
      return { ok: true, code: 0, stdout: 'test/readiness', stderr: '' }
    }
    if (signature === 'rev-parse --short=12 HEAD') {
      return { ok: true, code: 0, stdout: 'abc123def456', stderr: '' }
    }
    if (signature === 'status --porcelain=v1 --untracked-files=normal') {
      return statusInspectionOk
        ? {
            ok: true,
            code: 0,
            stdout: dirty ? ' M package.json' : '',
            stderr: '',
          }
        : { ok: false, code: 128, stdout: '', stderr: 'status failed' }
    }
    if (signature === 'ls-files -- .env .env.*') {
      return trackedInspectionOk
        ? { ok: true, code: 0, stdout: trackedEnv, stderr: '' }
        : { ok: false, code: 128, stdout: '', stderr: 'index failed' }
    }
    return { ok: false, code: 1, stdout: '', stderr: `unexpected git args: ${signature}` }
  }
}

async function createReadyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'readiness-fixture-'))
  await Promise.all([
    mkdir(join(root, 'scripts'), { recursive: true }),
    mkdir(join(root, 'docs'), { recursive: true }),
    mkdir(join(root, 'config', 'policies'), { recursive: true }),
    mkdir(join(root, '.github', 'workflows'), { recursive: true }),
    mkdir(join(root, 'src', 'entrypoints'), { recursive: true }),
    mkdir(join(root, 'node_modules'), { recursive: true }),
  ])

  const packageJson = {
    name: 'readiness-fixture',
    private: true,
    type: 'module',
    packageManager: 'bun@1.3.14',
    scripts: {
      readiness: 'node scripts/readiness.mjs',
      'readiness:json': 'node scripts/readiness.mjs --json',
      'readiness:strict': 'node scripts/readiness.mjs --strict',
      'test:readiness': 'node --test scripts/readiness.test.mjs',
      'policy:lint': 'node scripts/policy-lint.mjs',
      'test:policy': 'node --test scripts/policy-lint.test.mjs',
      check: 'node --test scripts/readiness.test.mjs scripts/policy-lint.test.mjs',
    },
    dependencies: { example: '^1.0.0' },
  }

  await Promise.all([
    writeFile(join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(join(root, 'bun.lock'), '{}\n'),
    writeFile(join(root, 'src', 'entrypoints', 'cli.tsx'), 'export {}\n'),
    writeFile(join(root, 'docs', 'engineering-readiness.md'), '# Readiness\n'),
    writeFile(join(root, 'docs', 'policy-as-code.md'), '# Policy\n'),
    writeFile(join(root, 'config', 'policies', 'default.json'), '{}\n'),
    writeFile(join(root, 'config', 'policies', 'schema.json'), '{}\n'),
    writeFile(join(root, '.github', 'workflows', 'quality-gate.yml'), 'name: test\n'),
    writeFile(
      join(root, '.gitignore'),
      [
        'node_modules/',
        '.env',
        '.env.*',
        '!.env.example',
        'coverage/',
        'readiness-report*.json',
        'policy-report*.json',
        '',
      ].join('\n'),
    ),
  ])

  return root
}

function fixedRuntime() {
  return {
    nodeVersion: 'v24.4.0',
    platform: 'linux',
    arch: 'x64',
  }
}

test('parseArgs resolves paths and machine-output flags', () => {
  const result = parseArgs(
    ['--json', '--strict', '--root', 'project', '--output=reports/readiness.json'],
    { cwd: '/workspace' },
  )

  assert.equal(result.json, true)
  assert.equal(result.strict, true)
  assert.equal(result.root, '/workspace/project')
  assert.equal(result.output, '/workspace/reports/readiness.json')
})

test('parseArgs rejects unknown options', () => {
  assert.throws(() => parseArgs(['--mystery']), CliUsageError)
})

test('summary, score and strict exit policy are deterministic', () => {
  const checks = [
    { status: 'pass', weight: 4, strictBlocking: false },
    { status: 'warn', weight: 2, strictBlocking: true },
    { status: 'skip', weight: 10, strictBlocking: false },
  ]
  const summary = summarizeChecks(checks)
  const report = { checks, gate: { strict: true } }

  assert.deepEqual(summary, {
    total: 3,
    pass: 1,
    warn: 1,
    fail: 0,
    skip: 1,
    strictBlockingWarnings: 1,
  })
  assert.equal(calculateScore(checks), 83)
  assert.equal(getExitCode(report, false), 0)
  assert.equal(getExitCode(report, true), 1)
})

test('home paths are redacted without changing unrelated paths', () => {
  assert.equal(redactHomePath('/home/alex/project', '/home/alex'), '~/project')
  assert.equal(redactHomePath('/srv/project', '/home/alex'), '/srv/project')
})

test('a complete fixture passes the strict readiness gate', async t => {
  const root = await createReadyFixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  let tick = 100
  const report = await runReadiness({
    root,
    strict: true,
    env: {},
    homeDir: join(root, 'home'),
    commandRunner: fakeCommandRunner(),
    runtime: fixedRuntime(),
    now: () => new Date('2026-08-23T12:00:00.000Z'),
    clock: () => tick++,
  })

  assert.equal(report.schemaVersion, 1)
  assert.equal(report.generatedAt, '2026-08-23T12:00:00.000Z')
  assert.equal(report.durationMs, 1)
  assert.equal(report.status, 'ready')
  assert.equal(report.score, 100)
  assert.equal(report.gate.passed, true)
  assert.equal(report.gate.exitCode, 0)
  assert.equal(report.summary.fail, 0)
  assert.equal(report.summary.warn, 0)
  assert.equal(report.summary.total, 19)
  assert.equal(report.project.branch, 'test/readiness')
  assert.deepEqual(report.recommendations, [])
})

test('missing Bun blocks the gate with an actionable failure', async t => {
  const root = await createReadyFixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const report = await runReadiness({
    root,
    strict: false,
    env: {},
    homeDir: join(root, 'home'),
    commandRunner: fakeCommandRunner({ bunAvailable: false }),
    runtime: fixedRuntime(),
  })

  const bunCheck = report.checks.find(check => check.id === 'runtime.bun')
  assert.equal(bunCheck.status, 'fail')
  assert.match(bunCheck.remediation, /Install Bun 1\.3\.14/)
  assert.equal(report.status, 'blocked')
  assert.equal(report.gate.exitCode, 1)
})

test('a failed Git index inspection cannot be reported as safe', async t => {
  const root = await createReadyFixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const report = await runReadiness({
    root,
    strict: true,
    env: {},
    homeDir: join(root, 'home'),
    commandRunner: fakeCommandRunner({ trackedInspectionOk: false }),
    runtime: fixedRuntime(),
  })

  const trackedEnvCheck = report.checks.find(check => check.id === 'security.tracked-env')
  assert.equal(trackedEnvCheck.status, 'warn')
  assert.equal(trackedEnvCheck.strictBlocking, true)
  assert.equal(report.gate.exitCode, 1)
})

test('the check set stays stable when Git is unavailable', async t => {
  const root = await createReadyFixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const report = await runReadiness({
    root,
    strict: false,
    env: {},
    homeDir: join(root, 'home'),
    commandRunner: fakeCommandRunner({ gitAvailable: false }),
    runtime: fixedRuntime(),
  })

  assert.equal(report.summary.total, 19)
  assert.equal(report.checks.find(check => check.id === 'runtime.git').status, 'fail')
  assert.equal(report.checks.find(check => check.id === 'repository.git').status, 'skip')
  assert.equal(
    report.checks.find(check => check.id === 'repository.working-tree').status,
    'skip',
  )
  assert.equal(report.checks.find(check => check.id === 'security.tracked-env').status, 'skip')
})

test('provider secret values never appear in the report', async t => {
  const root = await createReadyFixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const secret = 'sk-test-do-not-leak-1234567890'
  const report = await runReadiness({
    root,
    strict: false,
    env: { ANTHROPIC_API_KEY: secret },
    homeDir: join(root, 'home'),
    commandRunner: fakeCommandRunner(),
    runtime: fixedRuntime(),
  })

  assert.equal(report.checks.find(check => check.id === 'provider.configuration').status, 'pass')
  assert.equal(JSON.stringify(report).includes(secret), false)
})

test('human output groups each category once', async t => {
  const root = await createReadyFixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const report = await runReadiness({
    root,
    strict: false,
    env: {},
    homeDir: join(root, 'home'),
    commandRunner: fakeCommandRunner({ dirty: true }),
    runtime: fixedRuntime(),
  })
  const output = formatHumanReport(report)
  assert.equal((output.match(/^RUNTIME$/gm) ?? []).length, 1)
  assert.equal((output.match(/^PROJECT$/gm) ?? []).length, 1)
  assert.match(output, /Working tree contains|working tree contains/i)
})
