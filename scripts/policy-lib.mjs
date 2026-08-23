import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { relative, resolve } from 'node:path'

export const POLICY_SCHEMA_VERSION = 1
export const POLICY_TOOL_VERSION = '0.1.0'
const DECISIONS = new Set(['allow', 'confirm', 'deny'])
const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'defaultProfile', 'profiles'])
const PROFILE_KEYS = new Set(['description', 'filesystem', 'shell', 'network', 'tools'])
const FILESYSTEM_KEYS = new Set(['outsideProject', 'read', 'write', 'deny'])
const SHELL_KEYS = new Set(['defaultDecision', 'allow', 'deny'])
const NETWORK_KEYS = new Set([
  'defaultDecision',
  'allowHosts',
  'denyHosts',
  'denyPrivateRanges',
])
const TOOLS_KEYS = new Set(['defaultDecision', 'rules'])
const TOOL_RULE_KEYS = new Set(['tool', 'decision', 'when'])

export class PolicyUsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PolicyUsageError'
  }
}

export function parsePolicyArgs(argv, { cwd = process.cwd() } = {}) {
  const options = {
    root: resolve(cwd),
    policyPath: null,
    json: false,
    output: null,
    help: false,
  }

  const readValue = (flag, index) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new PolicyUsageError(`${flag} requires a value`)
    }
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--root') {
      options.root = resolve(cwd, readValue(arg, index))
      index += 1
      continue
    }
    if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length)
      if (!value) throw new PolicyUsageError('--root requires a value')
      options.root = resolve(cwd, value)
      continue
    }
    if (arg === '--output') {
      options.output = resolve(cwd, readValue(arg, index))
      index += 1
      continue
    }
    if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length)
      if (!value) throw new PolicyUsageError('--output requires a value')
      options.output = resolve(cwd, value)
      continue
    }
    if (arg.startsWith('--')) {
      throw new PolicyUsageError(`Unknown option: ${arg}`)
    }
    if (options.policyPath) {
      throw new PolicyUsageError('Only one policy file can be validated at a time')
    }
    options.policyPath = resolve(cwd, arg)
  }

  if (!options.policyPath) {
    options.policyPath = resolve(options.root, 'config', 'policies', 'default.json')
  }
  return options
}

export function getPolicyUsage() {
  return `Policy-as-Code Linter

Usage:
  node scripts/policy-lint.mjs [policy-file] [options]

Options:
  --json                 Print the machine-readable validation report
  --output <path>        Write the JSON report to a file
  --root <path>          Resolve the default policy from another project root
  -h, --help             Show this help

Exit codes:
  0  Policy is valid
  1  Policy validation failed
  2  Invalid arguments or an internal execution error
`
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function addIssue(target, path, code, message) {
  target.push({ path, code, message })
}

function rejectUnknownKeys(value, allowed, path, errors) {
  if (!isPlainObject(value)) return
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) {
      addIssue(errors, `${path}.${key}`, 'unknown-key', `Unknown property: ${key}`)
    }
  }
}

function validateDecision(value, path, errors) {
  if (!DECISIONS.has(value)) {
    addIssue(
      errors,
      path,
      'invalid-decision',
      'Decision must be one of: allow, confirm, deny.',
    )
    return false
  }
  return true
}

function validateString(value, path, errors, { minLength = 1 } = {}) {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    addIssue(errors, path, 'invalid-string', 'Expected a non-empty string.')
    return false
  }
  return true
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value)) {
    addIssue(errors, path, 'invalid-array', 'Expected an array of strings.')
    return []
  }

  const normalized = []
  const seen = new Set()
  value.forEach((item, index) => {
    if (!validateString(item, `${path}[${index}]`, errors)) return
    const text = item.trim()
    if (seen.has(text)) {
      addIssue(
        errors,
        `${path}[${index}]`,
        'duplicate-value',
        `Duplicate value: ${text}`,
      )
      return
    }
    seen.add(text)
    normalized.push(text)
  })
  return normalized
}

function hasAnyPattern(patterns, expected) {
  return expected.some(pattern => patterns.includes(pattern))
}

function validateFilesystem(value, path, errors, warnings) {
  if (!isPlainObject(value)) {
    addIssue(errors, path, 'invalid-object', 'Filesystem policy must be an object.')
    return
  }
  rejectUnknownKeys(value, FILESYSTEM_KEYS, path, errors)
  const outsideProjectValid = validateDecision(
    value.outsideProject,
    `${path}.outsideProject`,
    errors,
  )
  const read = validateStringArray(value.read, `${path}.read`, errors)
  const write = validateStringArray(value.write, `${path}.write`, errors)
  const deny = validateStringArray(value.deny, `${path}.deny`, errors)

  if (outsideProjectValid && value.outsideProject === 'allow') {
    addIssue(
      errors,
      `${path}.outsideProject`,
      'unsafe-outside-project',
      'The baseline policy may not allow unrestricted access outside the project.',
    )
  }
  if (!hasAnyPattern(deny, ['.env', '.env.*', '**/.env', '**/.env*'])) {
    addIssue(
      errors,
      `${path}.deny`,
      'missing-env-guard',
      'Deny rules must cover environment credential files.',
    )
  }
  if (!hasAnyPattern(deny, ['.git/**', '**/.git/**'])) {
    addIssue(
      errors,
      `${path}.deny`,
      'missing-git-guard',
      'Deny rules must protect Git metadata from direct writes.',
    )
  }
  if (!hasAnyPattern(deny, ['~/.ssh/**', '**/.ssh/**'])) {
    addIssue(
      errors,
      `${path}.deny`,
      'missing-ssh-guard',
      'Deny rules must protect SSH credentials.',
    )
  }
  if (write.includes('**')) {
    addIssue(
      warnings,
      `${path}.write`,
      'broad-write-scope',
      'The profile can write anywhere inside the project.',
    )
  }
  if (read.length === 0) {
    addIssue(
      warnings,
      `${path}.read`,
      'empty-read-scope',
      'The profile has no declared readable paths.',
    )
  }
}

function validateShell(value, path, errors, warnings) {
  if (!isPlainObject(value)) {
    addIssue(errors, path, 'invalid-object', 'Shell policy must be an object.')
    return
  }
  rejectUnknownKeys(value, SHELL_KEYS, path, errors)
  const decisionValid = validateDecision(
    value.defaultDecision,
    `${path}.defaultDecision`,
    errors,
  )
  const allow = validateStringArray(value.allow, `${path}.allow`, errors)
  const deny = validateStringArray(value.deny, `${path}.deny`, errors)

  if (deny.length === 0) {
    addIssue(
      errors,
      `${path}.deny`,
      'empty-shell-deny-list',
      'Every profile must define explicit shell deny rules.',
    )
  }
  if (decisionValid && value.defaultDecision === 'allow') {
    addIssue(
      warnings,
      `${path}.defaultDecision`,
      'permissive-shell-default',
      'Unmatched shell commands are allowed; explicit deny rules remain critical.',
    )
  }
  if (allow.includes('*')) {
    addIssue(
      errors,
      `${path}.allow`,
      'unbounded-shell-allow',
      'A bare wildcard may not be used as a shell allow rule.',
    )
  }
}

function validateNetwork(value, path, errors, warnings) {
  if (!isPlainObject(value)) {
    addIssue(errors, path, 'invalid-object', 'Network policy must be an object.')
    return
  }
  rejectUnknownKeys(value, NETWORK_KEYS, path, errors)
  const decisionValid = validateDecision(
    value.defaultDecision,
    `${path}.defaultDecision`,
    errors,
  )
  const allowHosts = validateStringArray(value.allowHosts, `${path}.allowHosts`, errors)
  validateStringArray(value.denyHosts, `${path}.denyHosts`, errors)

  if (value.denyPrivateRanges !== true) {
    addIssue(
      errors,
      `${path}.denyPrivateRanges`,
      'private-network-not-denied',
      'Private network ranges must remain denied by the baseline policy.',
    )
  }
  if (allowHosts.includes('*')) {
    addIssue(
      errors,
      `${path}.allowHosts`,
      'unbounded-network-allow',
      'A bare wildcard may not be used as an allowed host.',
    )
  }
  if (decisionValid && value.defaultDecision === 'allow') {
    addIssue(
      warnings,
      `${path}.defaultDecision`,
      'permissive-network-default',
      'Unmatched network destinations are allowed.',
    )
  }
}

function validateTools(value, path, errors, warnings) {
  if (!isPlainObject(value)) {
    addIssue(errors, path, 'invalid-object', 'Tool policy must be an object.')
    return
  }
  rejectUnknownKeys(value, TOOLS_KEYS, path, errors)
  const decisionValid = validateDecision(
    value.defaultDecision,
    `${path}.defaultDecision`,
    errors,
  )
  if (!Array.isArray(value.rules)) {
    addIssue(errors, `${path}.rules`, 'invalid-array', 'Expected an array of tool rules.')
    return
  }

  const ruleKeys = new Set()
  value.rules.forEach((rule, index) => {
    const rulePath = `${path}.rules[${index}]`
    if (!isPlainObject(rule)) {
      addIssue(errors, rulePath, 'invalid-object', 'Tool rule must be an object.')
      return
    }
    rejectUnknownKeys(rule, TOOL_RULE_KEYS, rulePath, errors)
    const toolValid = validateString(rule.tool, `${rulePath}.tool`, errors)
    validateDecision(rule.decision, `${rulePath}.decision`, errors)
    if (rule.when !== undefined) {
      validateString(rule.when, `${rulePath}.when`, errors)
    }
    if (toolValid) {
      const key = `${rule.tool}\u0000${rule.when ?? ''}`
      if (ruleKeys.has(key)) {
        addIssue(
          errors,
          rulePath,
          'duplicate-tool-rule',
          'Duplicate tool rule for the same tool and condition.',
        )
      }
      ruleKeys.add(key)
    }
  })

  if (decisionValid && value.defaultDecision === 'allow') {
    addIssue(
      warnings,
      `${path}.defaultDecision`,
      'permissive-tool-default',
      'Unmatched tools are allowed by default.',
    )
  }
}

export function validatePolicy(policy) {
  const errors = []
  const warnings = []

  if (!isPlainObject(policy)) {
    addIssue(errors, '$', 'invalid-object', 'Policy document must be a JSON object.')
    return buildValidationResult([], errors, warnings)
  }

  rejectUnknownKeys(policy, TOP_LEVEL_KEYS, '$', errors)
  if (policy.schemaVersion !== POLICY_SCHEMA_VERSION) {
    addIssue(
      errors,
      '$.schemaVersion',
      'unsupported-schema-version',
      `schemaVersion must equal ${POLICY_SCHEMA_VERSION}.`,
    )
  }
  validateString(policy.defaultProfile, '$.defaultProfile', errors)

  if (!isPlainObject(policy.profiles) || Object.keys(policy.profiles).length === 0) {
    addIssue(errors, '$.profiles', 'invalid-profiles', 'At least one profile is required.')
    return buildValidationResult([], errors, warnings)
  }

  const profileNames = Object.keys(policy.profiles).sort()
  if (
    typeof policy.defaultProfile === 'string' &&
    !Object.hasOwn(policy.profiles, policy.defaultProfile)
  ) {
    addIssue(
      errors,
      '$.defaultProfile',
      'unknown-default-profile',
      'defaultProfile must reference a declared profile.',
    )
  }

  for (const profileName of profileNames) {
    const profilePath = `$.profiles.${profileName}`
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(profileName)) {
      addIssue(
        errors,
        profilePath,
        'invalid-profile-name',
        'Profile names must be 2-32 lowercase letters, digits or hyphens.',
      )
    }
    const profile = policy.profiles[profileName]
    if (!isPlainObject(profile)) {
      addIssue(errors, profilePath, 'invalid-object', 'Profile must be an object.')
      continue
    }
    rejectUnknownKeys(profile, PROFILE_KEYS, profilePath, errors)
    validateString(profile.description, `${profilePath}.description`, errors)
    validateFilesystem(profile.filesystem, `${profilePath}.filesystem`, errors, warnings)
    validateShell(profile.shell, `${profilePath}.shell`, errors, warnings)
    validateNetwork(profile.network, `${profilePath}.network`, errors, warnings)
    validateTools(profile.tools, `${profilePath}.tools`, errors, warnings)
  }

  return buildValidationResult(profileNames, errors, warnings)
}

function buildValidationResult(profileNames, errors, warnings) {
  const compareIssues = (left, right) => {
    const pathOrder = left.path.localeCompare(right.path)
    if (pathOrder !== 0) return pathOrder
    return left.code.localeCompare(right.code)
  }
  errors.sort(compareIssues)
  warnings.sort(compareIssues)
  return {
    valid: errors.length === 0,
    profiles: profileNames,
    summary: {
      profiles: profileNames.length,
      errors: errors.length,
      warnings: warnings.length,
    },
    errors,
    warnings,
  }
}

export async function loadAndValidatePolicy(policyPath) {
  let source
  try {
    source = await readFile(policyPath, 'utf8')
  } catch (error) {
    return {
      valid: false,
      profiles: [],
      summary: { profiles: 0, errors: 1, warnings: 0 },
      errors: [
        {
          path: '$',
          code: error?.code === 'ENOENT' ? 'file-not-found' : 'file-unreadable',
          message:
            error?.code === 'ENOENT'
              ? 'Policy file does not exist.'
              : 'Policy file could not be read.',
        },
      ],
      warnings: [],
    }
  }

  let policy
  try {
    policy = JSON.parse(source)
  } catch {
    return {
      valid: false,
      profiles: [],
      summary: { profiles: 0, errors: 1, warnings: 0 },
      errors: [
        {
          path: '$',
          code: 'invalid-json',
          message: 'Policy file contains invalid JSON.',
        },
      ],
      warnings: [],
    }
  }

  return validatePolicy(policy)
}

function displayPath(policyPath, root, homeDir) {
  const resolvedPolicy = resolve(policyPath)
  const resolvedRoot = resolve(root)
  const relativeToRoot = relative(resolvedRoot, resolvedPolicy)
  if (relativeToRoot && !relativeToRoot.startsWith('..')) return relativeToRoot
  const resolvedHome = resolve(homeDir)
  const relativeToHome = relative(resolvedHome, resolvedPolicy)
  if (relativeToHome && !relativeToHome.startsWith('..')) return `~/${relativeToHome}`
  return '<external-policy>'
}

export async function createPolicyReport({
  policyPath,
  root = process.cwd(),
  homeDir = homedir(),
  now = () => new Date(),
} = {}) {
  if (!policyPath) throw new PolicyUsageError('policyPath is required')
  const validation = await loadAndValidatePolicy(policyPath)
  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    tool: { name: 'policy-lint', version: POLICY_TOOL_VERSION },
    generatedAt: now().toISOString(),
    policyFile: displayPath(policyPath, root, homeDir),
    ...validation,
  }
}

export function formatPolicyReport(report) {
  const lines = [
    'Policy-as-Code Linter',
    `Policy: ${report.policyFile}`,
    `Status: ${report.valid ? 'VALID' : 'INVALID'} · Profiles: ${report.summary.profiles} · Errors: ${report.summary.errors} · Warnings: ${report.summary.warnings}`,
  ]

  if (report.errors.length > 0) {
    lines.push('', 'Errors:')
    report.errors.forEach(issue => {
      lines.push(`  ✗ ${issue.path} [${issue.code}] ${issue.message}`)
    })
  }
  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:')
    report.warnings.forEach(issue => {
      lines.push(`  ! ${issue.path} [${issue.code}] ${issue.message}`)
    })
  }
  if (report.valid && report.warnings.length === 0) {
    lines.push('', 'The policy contract and baseline safety invariants are satisfied.')
  }
  return `${lines.join('\n')}\n`
}
