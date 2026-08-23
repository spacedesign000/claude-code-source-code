import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const READINESS_SCHEMA_VERSION = 1
export const READINESS_TOOL_VERSION = '1.0.0'
export const REQUIRED_SCRIPTS = Object.freeze([
  'readiness',
  'readiness:json',
  'readiness:strict',
  'test:readiness',
  'policy:lint',
  'test:policy',
  'check',
])

const CATEGORY_ORDER = Object.freeze([
  'runtime',
  'project',
  'repository',
  'quality',
  'security',
  'dependencies',
  'policy',
  'provider',
])
const STATUS_ORDER = Object.freeze({ fail: 0, warn: 1, skip: 2, pass: 3 })
const ALLOWED_STATUSES = new Set(Object.keys(STATUS_ORDER))
const ALLOWED_SEVERITIES = new Set(['info', 'warning', 'error'])
const SAFE_ENV_TEMPLATES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.defaults',
])

export class CliUsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CliUsageError'
  }
}

export function parseArgs(argv, { cwd = process.cwd() } = {}) {
  const options = {
    root: resolve(cwd),
    json: false,
    strict: false,
    output: null,
    help: false,
  }

  const readValue = (flag, index) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new CliUsageError(`${flag} requires a value`)
    }
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--strict') {
      options.strict = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--root' || arg === '--cwd') {
      const value = readValue(arg, index)
      options.root = resolve(cwd, value)
      index += 1
      continue
    }
    if (arg.startsWith('--root=') || arg.startsWith('--cwd=')) {
      const value = arg.slice(arg.indexOf('=') + 1)
      if (!value) throw new CliUsageError(`${arg.split('=')[0]} requires a value`)
      options.root = resolve(cwd, value)
      continue
    }
    if (arg === '--output') {
      const value = readValue(arg, index)
      options.output = resolve(cwd, value)
      index += 1
      continue
    }
    if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length)
      if (!value) throw new CliUsageError('--output requires a value')
      options.output = resolve(cwd, value)
      continue
    }

    throw new CliUsageError(`Unknown option: ${arg}`)
  }

  return options
}

export function getUsage() {
  return `Engineering Readiness Gate

Usage:
  node scripts/readiness.mjs [options]

Options:
  --json                 Print the complete machine-readable report to stdout
  --strict               Fail on warnings marked as strict blockers
  --output <path>        Write the JSON report to a file
  --root <path>          Inspect another project root (alias: --cwd)
  -h, --help             Show this help

Exit codes:
  0  Gate passed
  1  A required check failed, or --strict found a blocking warning
  2  Invalid arguments or an internal execution error
`
}

export async function defaultCommandRunner(command, args, cwd) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
    })
    return {
      ok: true,
      code: 0,
      stdout: String(result.stdout ?? '').trim(),
      stderr: String(result.stderr ?? '').trim(),
    }
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === 'number' ? error.code : null,
      stdout: String(error?.stdout ?? '').trim(),
      stderr: String(error?.stderr ?? error?.message ?? '').trim(),
    }
  }
}

export function redactHomePath(value, home = homedir()) {
  if (typeof value !== 'string' || value.length === 0) return value
  const normalizedValue = resolve(value)
  const normalizedHome = resolve(home)

  if (normalizedValue === normalizedHome) return '~'
  if (normalizedValue.startsWith(`${normalizedHome}${sep}`)) {
    return `~${sep}${relative(normalizedHome, normalizedValue)}`
  }
  return normalizedValue
}

export function summarizeChecks(checks) {
  const summary = {
    total: checks.length,
    pass: 0,
    warn: 0,
    fail: 0,
    skip: 0,
    strictBlockingWarnings: 0,
  }

  for (const check of checks) {
    if (!ALLOWED_STATUSES.has(check.status)) {
      throw new TypeError(`Unsupported readiness status: ${check.status}`)
    }
    summary[check.status] += 1
    if (check.status === 'warn' && check.strictBlocking) {
      summary.strictBlockingWarnings += 1
    }
  }

  return summary
}

export function calculateScore(checks) {
  let possible = 0
  let earned = 0

  for (const check of checks) {
    if (check.status === 'skip') continue
    const weight = Number.isFinite(check.weight) && check.weight > 0 ? check.weight : 1
    possible += weight
    if (check.status === 'pass') earned += weight
    if (check.status === 'warn') earned += weight * 0.5
  }

  if (possible === 0) return 100
  return Math.max(0, Math.min(100, Math.round((earned / possible) * 100)))
}

export function getExitCode(report, strict = report?.gate?.strict ?? false) {
  const checks = report?.checks ?? []
  if (checks.some(check => check.status === 'fail')) return 1
  if (
    strict &&
    checks.some(check => check.status === 'warn' && check.strictBlocking)
  ) {
    return 1
  }
  return 0
}

function makeCheck(input) {
  const check = {
    id: input.id,
    category: input.category,
    title: input.title,
    status: input.status,
    severity: input.severity,
    strictBlocking: Boolean(input.strictBlocking),
    weight: input.weight ?? 1,
    message: input.message,
    ...(input.remediation ? { remediation: input.remediation } : {}),
    ...(input.details ? { details: input.details } : {}),
  }

  if (!check.id || !check.category || !check.title || !check.message) {
    throw new TypeError('Every readiness check needs an id, category, title and message')
  }
  if (!ALLOWED_STATUSES.has(check.status)) {
    throw new TypeError(`Unsupported readiness status: ${check.status}`)
  }
  if (!ALLOWED_SEVERITIES.has(check.severity)) {
    throw new TypeError(`Unsupported readiness severity: ${check.severity}`)
  }

  return check
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadPackageJson(root) {
  const packagePath = join(root, 'package.json')
  let source
  try {
    source = await readFile(packagePath, 'utf8')
  } catch (error) {
    return {
      ok: false,
      value: null,
      reason: error?.code === 'ENOENT' ? 'missing' : 'unreadable',
    }
  }

  try {
    return { ok: true, value: JSON.parse(source), reason: null }
  } catch {
    return { ok: false, value: null, reason: 'invalid-json' }
  }
}

function parseVersion(value) {
  const match = String(value ?? '')
    .trim()
    .replace(/^v/, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    normalized: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
  }
}

function expectedBunVersion(packageJson) {
  const packageManager = packageJson?.packageManager
  if (typeof packageManager !== 'string') return null
  const match = packageManager.match(/^bun@(\d+\.\d+\.\d+)$/)
  return match?.[1] ?? null
}

function safeTrackedEnvFiles(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(path => !SAFE_ENV_TEMPLATES.has(basename(path).toLowerCase()))
    .sort()
}

function collectWildcardDependencies(packageJson) {
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies']
  const wildcard = []
  for (const section of sections) {
    for (const [name, version] of Object.entries(packageJson?.[section] ?? {})) {
      if (version === '*' || version === 'latest') {
        wildcard.push(`${section}:${name}`)
      }
    }
  }
  return wildcard.sort()
}

function hasIgnoreRule(lines, predicate) {
  return lines.some(line => predicate(line.trim()))
}

function evaluateGitignore(source) {
  const lines = String(source ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))

  const requirements = [
    {
      name: 'environment files',
      ok:
        hasIgnoreRule(lines, line => line === '.env') &&
        hasIgnoreRule(lines, line => line === '.env.*'),
    },
    {
      name: 'coverage output',
      ok: hasIgnoreRule(lines, line => line === 'coverage/' || line === 'coverage'),
    },
    {
      name: 'readiness and policy reports',
      ok:
        hasIgnoreRule(lines, line => line.includes('readiness-report')) &&
        hasIgnoreRule(lines, line => line.includes('policy-report')),
    },
  ]

  return requirements.filter(requirement => !requirement.ok).map(item => item.name)
}

function dedupeRecommendations(checks) {
  return [
    ...new Set(
      checks
        .filter(check => (check.status === 'warn' || check.status === 'fail') && check.remediation)
        .map(check => check.remediation),
    ),
  ]
}

function sortChecks(checks) {
  const categoryIndex = category => {
    const index = CATEGORY_ORDER.indexOf(category)
    return index === -1 ? CATEGORY_ORDER.length : index
  }

  return [...checks].sort((left, right) => {
    const category = categoryIndex(left.category) - categoryIndex(right.category)
    if (category !== 0) return category
    const status = STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
    if (status !== 0) return status
    return left.id.localeCompare(right.id)
  })
}

export async function runReadiness({
  root = process.cwd(),
  strict = false,
  env = process.env,
  homeDir = homedir(),
  commandRunner = defaultCommandRunner,
  runtime = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  now = () => new Date(),
  clock = () => Date.now(),
} = {}) {
  const startedAt = clock()
  const projectRoot = resolve(root)
  if (!(await pathExists(projectRoot))) {
    throw new CliUsageError(`Project root does not exist: ${projectRoot}`)
  }

  const checks = []
  const packageResult = await loadPackageJson(projectRoot)
  const packageJson = packageResult.value
  const expectedBun = expectedBunVersion(packageJson)

  const nodeVersion = parseVersion(runtime.nodeVersion)
  const nodeReady = Boolean(nodeVersion && nodeVersion.major >= 20)
  checks.push(
    makeCheck({
      id: 'runtime.node',
      category: 'runtime',
      title: 'Node.js runtime',
      status: nodeReady ? 'pass' : 'fail',
      severity: nodeReady ? 'info' : 'error',
      strictBlocking: true,
      weight: 3,
      message: nodeVersion
        ? `Node.js ${nodeVersion.normalized} is active.`
        : `Unable to parse Node.js version: ${runtime.nodeVersion}`,
      remediation: nodeReady
        ? undefined
        : 'Install Node.js 20 or newer before running repository automation.',
    }),
  )

  checks.push(
    makeCheck({
      id: 'project.package-json',
      category: 'project',
      title: 'Project manifest',
      status: packageResult.ok ? 'pass' : 'fail',
      severity: packageResult.ok ? 'info' : 'error',
      strictBlocking: true,
      weight: 4,
      message: packageResult.ok
        ? `Loaded package.json for ${packageJson.name ?? 'unnamed project'}.`
        : packageResult.reason === 'missing'
          ? 'package.json is missing.'
          : packageResult.reason === 'invalid-json'
            ? 'package.json contains invalid JSON.'
            : 'package.json could not be read.',
      remediation: packageResult.ok
        ? undefined
        : 'Restore a readable, valid package.json at the repository root.',
      details: packageResult.ok ? undefined : { reason: packageResult.reason },
    }),
  )

  const bunResult = await commandRunner('bun', ['--version'], projectRoot)
  const bunVersion = parseVersion(bunResult.stdout)
  let bunStatus = 'pass'
  let bunMessage = ''
  let bunRemediation
  if (!bunResult.ok || !bunVersion) {
    bunStatus = 'fail'
    bunMessage = 'Bun is not available on PATH.'
    bunRemediation = `Install Bun${expectedBun ? ` ${expectedBun}` : ''} and ensure the executable is on PATH.`
  } else if (!expectedBun) {
    bunStatus = 'warn'
    bunMessage = `Bun ${bunVersion.normalized} is active, but package.json does not pin a packageManager version.`
    bunRemediation = 'Pin an exact Bun version through packageManager to keep local and CI installs reproducible.'
  } else if (bunVersion.normalized !== expectedBun) {
    bunStatus = 'warn'
    bunMessage = `Bun ${bunVersion.normalized} is active, but the project pins ${expectedBun}.`
    bunRemediation = `Use Bun ${expectedBun} to keep local and CI installs reproducible.`
  } else {
    bunMessage = `Bun ${bunVersion.normalized} is available and matches the project pin.`
  }
  checks.push(
    makeCheck({
      id: 'runtime.bun',
      category: 'runtime',
      title: 'Bun runtime',
      status: bunStatus,
      severity: bunStatus === 'fail' ? 'error' : bunStatus === 'warn' ? 'warning' : 'info',
      strictBlocking: true,
      weight: 5,
      message: bunMessage,
      remediation: bunRemediation,
      details: expectedBun ? { expectedVersion: expectedBun } : undefined,
    }),
  )

  const gitVersion = await commandRunner('git', ['--version'], projectRoot)
  checks.push(
    makeCheck({
      id: 'runtime.git',
      category: 'runtime',
      title: 'Git runtime',
      status: gitVersion.ok ? 'pass' : 'fail',
      severity: gitVersion.ok ? 'info' : 'error',
      strictBlocking: true,
      weight: 3,
      message: gitVersion.ok
        ? `${gitVersion.stdout || 'Git'} is available.`
        : 'Git is not available on PATH.',
      remediation: gitVersion.ok
        ? undefined
        : 'Install Git and ensure the executable is on PATH.',
    }),
  )

  let branch = null
  let commit = null
  let isGitRepository = false
  let worktreeCheck
  let trackedEnvCheck

  if (!gitVersion.ok) {
    checks.push(
      makeCheck({
        id: 'repository.git',
        category: 'repository',
        title: 'Git worktree',
        status: 'skip',
        severity: 'info',
        strictBlocking: false,
        weight: 2,
        message: 'The worktree check was skipped because Git is unavailable.',
      }),
    )
    worktreeCheck = makeCheck({
      id: 'repository.working-tree',
      category: 'repository',
      title: 'Working tree state',
      status: 'skip',
      severity: 'info',
      strictBlocking: false,
      weight: 1,
      message: 'Working tree changes were not inspected because Git is unavailable.',
    })
    trackedEnvCheck = makeCheck({
      id: 'security.tracked-env',
      category: 'security',
      title: 'Tracked environment files',
      status: 'skip',
      severity: 'info',
      strictBlocking: false,
      weight: 5,
      message: 'Tracked environment files were not inspected because Git is unavailable.',
    })
  } else {
    const inside = await commandRunner(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      projectRoot,
    )
    isGitRepository = inside.ok && inside.stdout === 'true'
    checks.push(
      makeCheck({
        id: 'repository.git',
        category: 'repository',
        title: 'Git worktree',
        status: isGitRepository ? 'pass' : 'warn',
        severity: isGitRepository ? 'info' : 'warning',
        strictBlocking: !isGitRepository,
        weight: 2,
        message: isGitRepository
          ? 'The project root is a Git worktree.'
          : 'The project root is not a readable Git worktree; integrity checks are limited.',
        remediation: isGitRepository
          ? undefined
          : 'Run the strict gate inside a Git clone to enable branch, state and tracked-secret checks.',
      }),
    )

    if (isGitRepository) {
      const [branchResult, commitResult, statusResult, trackedEnvResult] =
        await Promise.all([
          commandRunner('git', ['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot),
          commandRunner('git', ['rev-parse', '--short=12', 'HEAD'], projectRoot),
          commandRunner(
            'git',
            ['status', '--porcelain=v1', '--untracked-files=normal'],
            projectRoot,
          ),
          commandRunner(
            'git',
            ['ls-files', '--', '.env', '.env.*'],
            projectRoot,
          ),
        ])

      branch = branchResult.ok ? branchResult.stdout : null
      commit = commitResult.ok ? commitResult.stdout : null

      if (!statusResult.ok) {
        worktreeCheck = makeCheck({
          id: 'repository.working-tree',
          category: 'repository',
          title: 'Working tree state',
          status: 'warn',
          severity: 'warning',
          strictBlocking: true,
          weight: 1,
          message: 'Git could not inspect working tree changes.',
          remediation: 'Resolve the Git status error before relying on a strict release gate.',
        })
      } else {
        const changedFiles = statusResult.stdout.split(/\r?\n/).filter(Boolean).length
        worktreeCheck = makeCheck({
          id: 'repository.working-tree',
          category: 'repository',
          title: 'Working tree state',
          status: changedFiles === 0 ? 'pass' : 'warn',
          severity: changedFiles === 0 ? 'info' : 'warning',
          strictBlocking: false,
          weight: 1,
          message:
            changedFiles === 0
              ? 'The working tree is clean.'
              : `The working tree contains ${changedFiles} local change${changedFiles === 1 ? '' : 's'}.`,
          remediation:
            changedFiles === 0
              ? undefined
              : 'Review and commit or stash local changes before creating a release artifact.',
          details: { changedFileCount: changedFiles },
        })
      }

      if (!trackedEnvResult.ok) {
        trackedEnvCheck = makeCheck({
          id: 'security.tracked-env',
          category: 'security',
          title: 'Tracked environment files',
          status: 'warn',
          severity: 'warning',
          strictBlocking: true,
          weight: 5,
          message: 'Git could not determine whether sensitive .env files are tracked.',
          remediation: 'Resolve the Git index inspection error before merging or releasing.',
        })
      } else {
        const trackedEnvFiles = safeTrackedEnvFiles(trackedEnvResult.stdout)
        trackedEnvCheck = makeCheck({
          id: 'security.tracked-env',
          category: 'security',
          title: 'Tracked environment files',
          status: trackedEnvFiles.length === 0 ? 'pass' : 'fail',
          severity: trackedEnvFiles.length === 0 ? 'info' : 'error',
          strictBlocking: true,
          weight: 5,
          message:
            trackedEnvFiles.length === 0
              ? 'No sensitive .env files are tracked by Git.'
              : `${trackedEnvFiles.length} potentially sensitive environment file${trackedEnvFiles.length === 1 ? ' is' : 's are'} tracked by Git.`,
          remediation:
            trackedEnvFiles.length === 0
              ? undefined
              : 'Remove sensitive environment files from Git history and rotate any exposed credentials.',
          details:
            trackedEnvFiles.length === 0
              ? undefined
              : { trackedFiles: trackedEnvFiles },
        })
      }
    } else {
      worktreeCheck = makeCheck({
        id: 'repository.working-tree',
        category: 'repository',
        title: 'Working tree state',
        status: 'skip',
        severity: 'info',
        strictBlocking: false,
        weight: 1,
        message: 'Working tree changes were not inspected outside a Git worktree.',
      })
      trackedEnvCheck = makeCheck({
        id: 'security.tracked-env',
        category: 'security',
        title: 'Tracked environment files',
        status: 'skip',
        severity: 'info',
        strictBlocking: false,
        weight: 5,
        message: 'Tracked environment files were not inspected outside a Git worktree.',
      })
    }
  }

  checks.push(worktreeCheck, trackedEnvCheck)

  const fileDefinitions = [
    ['project.lockfile', 'project', 'Bun lockfile', 'bun.lock', 5, 'fail'],
    [
      'project.entrypoint',
      'project',
      'CLI entrypoint',
      join('src', 'entrypoints', 'cli.tsx'),
      5,
      'fail',
    ],
    ['project.dependencies', 'project', 'Installed dependencies', 'node_modules', 3, 'warn'],
    [
      'quality.workflow',
      'quality',
      'Readiness workflow',
      join('.github', 'workflows', 'quality-gate.yml'),
      3,
      'fail',
    ],
    [
      'quality.documentation',
      'quality',
      'Readiness documentation',
      join('docs', 'engineering-readiness.md'),
      2,
      'fail',
    ],
    [
      'quality.policy-documentation',
      'quality',
      'Policy documentation',
      join('docs', 'policy-as-code.md'),
      2,
      'fail',
    ],
    [
      'policy.configuration',
      'policy',
      'Default policy configuration',
      join('config', 'policies', 'default.json'),
      3,
      'fail',
    ],
    [
      'policy.schema',
      'policy',
      'Policy JSON schema',
      join('config', 'policies', 'schema.json'),
      2,
      'fail',
    ],
  ]

  const fileChecks = await Promise.all(
    fileDefinitions.map(async ([id, category, title, path, weight, missingStatus]) => ({
      id,
      category,
      title,
      path,
      weight,
      missingStatus,
      exists: await pathExists(join(projectRoot, path)),
    })),
  )

  for (const item of fileChecks) {
    const isDependencies = item.id === 'project.dependencies'
    const status = item.exists ? 'pass' : item.missingStatus
    checks.push(
      makeCheck({
        id: item.id,
        category: item.category,
        title: item.title,
        status,
        severity: status === 'fail' ? 'error' : status === 'warn' ? 'warning' : 'info',
        strictBlocking: !item.exists,
        weight: item.weight,
        message: item.exists
          ? `${item.path} is present.`
          : isDependencies
            ? 'Dependencies are not installed.'
            : `${item.path} is missing.`,
        remediation: item.exists
          ? undefined
          : isDependencies
            ? 'Run bun install --frozen-lockfile before validation.'
            : `Restore ${item.path} before merging.`,
      }),
    )
  }

  const scripts = packageJson?.scripts ?? {}
  const missingScripts = REQUIRED_SCRIPTS.filter(name => typeof scripts[name] !== 'string')
  checks.push(
    makeCheck({
      id: 'quality.scripts',
      category: 'quality',
      title: 'Quality scripts',
      status: missingScripts.length === 0 ? 'pass' : 'warn',
      severity: missingScripts.length === 0 ? 'info' : 'warning',
      strictBlocking: true,
      weight: 4,
      message:
        missingScripts.length === 0
          ? 'All readiness, policy and test scripts are registered in package.json.'
          : `${missingScripts.length} required quality script${missingScripts.length === 1 ? ' is' : 's are'} missing.`,
      remediation:
        missingScripts.length === 0
          ? undefined
          : 'Add the missing readiness and policy scripts to package.json.',
      details:
        missingScripts.length === 0 ? undefined : { missingScripts },
    }),
  )

  const wildcardDependencies = collectWildcardDependencies(packageJson)
  checks.push(
    makeCheck({
      id: 'dependencies.version-policy',
      category: 'dependencies',
      title: 'Dependency version policy',
      status: wildcardDependencies.length === 0 ? 'pass' : 'warn',
      severity: wildcardDependencies.length === 0 ? 'info' : 'warning',
      strictBlocking: false,
      weight: 4,
      message:
        wildcardDependencies.length === 0
          ? 'Dependency ranges avoid wildcard/latest specifications.'
          : `${wildcardDependencies.length} dependency specification${wildcardDependencies.length === 1 ? ' uses' : 's use'} * or latest. The lockfile limits current risk, but manifest-level reproducibility remains weak.`,
      remediation:
        wildcardDependencies.length === 0
          ? undefined
          : 'Replace wildcard/latest dependency ranges with reviewed, explicit compatible ranges in a dedicated dependency-hardening change.',
      details:
        wildcardDependencies.length === 0
          ? undefined
          : {
              count: wildcardDependencies.length,
              examples: wildcardDependencies.slice(0, 10),
            },
    }),
  )

  let gitignoreSource = ''
  try {
    gitignoreSource = await readFile(join(projectRoot, '.gitignore'), 'utf8')
  } catch {
    // Missing .gitignore is represented as all required rules missing.
  }
  const missingIgnoreRules = evaluateGitignore(gitignoreSource)
  checks.push(
    makeCheck({
      id: 'security.gitignore',
      category: 'security',
      title: 'Sensitive-output ignore policy',
      status: missingIgnoreRules.length === 0 ? 'pass' : 'warn',
      severity: missingIgnoreRules.length === 0 ? 'info' : 'warning',
      strictBlocking: true,
      weight: 4,
      message:
        missingIgnoreRules.length === 0
          ? '.gitignore covers environment files, coverage output and generated quality reports.'
          : `.gitignore is missing ${missingIgnoreRules.length} required protection rule${missingIgnoreRules.length === 1 ? '' : 's'}.`,
      remediation:
        missingIgnoreRules.length === 0
          ? undefined
          : 'Add ignore rules for environment files, coverage output and generated readiness/policy reports.',
      details:
        missingIgnoreRules.length === 0
          ? undefined
          : { missingRules: missingIgnoreRules },
    }),
  )

  const providerConfigured =
    Boolean(env.ANTHROPIC_API_KEY) ||
    Boolean(env.OPENROUTER_API_KEY) ||
    (await pathExists(join(homeDir, '.claude.json')))
  checks.push(
    makeCheck({
      id: 'provider.configuration',
      category: 'provider',
      title: 'Model provider configuration',
      status: providerConfigured ? 'pass' : 'skip',
      severity: 'info',
      strictBlocking: false,
      weight: 1,
      message: providerConfigured
        ? 'A provider credential source is available. Credential values were not read or included in the report.'
        : 'No provider credential source was detected. This is acceptable for CI-only checks.',
      remediation: providerConfigured
        ? undefined
        : 'Configure Anthropic or OpenRouter before starting an interactive model session.',
    }),
  )

  const orderedChecks = sortChecks(checks)
  const summary = summarizeChecks(orderedChecks)
  const score = calculateScore(orderedChecks)
  const status = summary.fail > 0 ? 'blocked' : summary.warn > 0 ? 'attention' : 'ready'
  const report = {
    schemaVersion: READINESS_SCHEMA_VERSION,
    tool: {
      name: 'engineering-readiness',
      version: READINESS_TOOL_VERSION,
    },
    generatedAt: now().toISOString(),
    durationMs: Math.max(0, clock() - startedAt),
    project: {
      name: packageJson?.name ?? null,
      root: redactHomePath(projectRoot, homeDir),
      branch,
      commit,
      runtime: {
        platform: runtime.platform,
        arch: runtime.arch,
      },
    },
    status,
    score,
    summary,
    gate: {
      strict: Boolean(strict),
      passed: false,
      exitCode: 1,
    },
    checks: orderedChecks,
    recommendations: dedupeRecommendations(orderedChecks),
  }

  report.gate.exitCode = getExitCode(report, strict)
  report.gate.passed = report.gate.exitCode === 0
  return report
}

export function formatHumanReport(report) {
  const symbol = { pass: '✓', warn: '!', fail: '✗', skip: '–' }
  const statusLabel = String(report.status ?? 'unknown').toUpperCase()
  const projectLabel = [report.project?.name, report.project?.branch, report.project?.commit]
    .filter(Boolean)
    .join(' · ')

  const lines = [
    'Engineering Readiness Gate',
    projectLabel ? `Project: ${projectLabel}` : 'Project: unknown',
    `Status: ${statusLabel} · Score: ${report.score}/100 · Gate: ${report.gate.passed ? 'PASS' : 'FAIL'}`,
    '',
  ]

  let category = null
  for (const check of report.checks) {
    if (check.category !== category) {
      category = check.category
      lines.push(category.toUpperCase())
    }
    lines.push(`  ${symbol[check.status]} ${check.title}: ${check.message}`)
    if ((check.status === 'warn' || check.status === 'fail') && check.remediation) {
      lines.push(`    Remedy: ${check.remediation}`)
    }
  }

  lines.push('')
  lines.push(
    `Summary: ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed, ${report.summary.skip} skipped.`,
  )
  if (report.gate.strict) {
    lines.push(
      `Strict blockers: ${report.summary.strictBlockingWarnings} warning${report.summary.strictBlockingWarnings === 1 ? '' : 's'}.`,
    )
  }

  if (report.recommendations.length > 0) {
    lines.push('')
    lines.push('Next actions:')
    report.recommendations.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item}`)
    })
  }

  return `${lines.join('\n')}\n`
}
