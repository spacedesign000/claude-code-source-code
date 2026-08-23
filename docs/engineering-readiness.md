# Engineering Readiness Gate

## Purpose

The Engineering Readiness Gate is a headless, dependency-free validation layer for local development, pull requests and release automation. It complements the interactive `/doctor` screen by producing deterministic results, stable exit codes and a machine-readable report that CI can archive.

The gate is intentionally conservative: a check is never reported as safe when the underlying inspection command failed. It also avoids reading or printing credential values.

## Commands

Run the human-readable report:

```bash
bun run readiness
```

Produce JSON on standard output:

```bash
bun run readiness:json
```

Run the merge/release policy. Strict mode fails on required warnings as well as hard failures:

```bash
bun run readiness:strict
```

Write a report while preserving the exit status:

```bash
node scripts/readiness.mjs --strict --output readiness-report.json
```

Inspect a different checkout:

```bash
node scripts/readiness.mjs --root ../another-checkout --json
```

Run unit tests or the full local quality command:

```bash
bun run test:readiness
bun run check
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The selected gate policy passed. Advisory warnings may still be present. |
| `1` | A required check failed, or strict mode found a warning marked as a strict blocker. |
| `2` | Invalid arguments or an unexpected execution error. |

The JSON report contains the same decision in `gate.exitCode` and `gate.passed`.

## Check catalogue

The current schema always emits the same check identifiers, even when a subsystem cannot be inspected. Unavailable inspections are represented as `skip` or a strict `warn`; checks are never silently omitted.

| Category | Representative checks |
| --- | --- |
| Runtime | Node.js version, Bun availability and pin, Git availability |
| Project | `package.json`, `bun.lock`, CLI entrypoint, installed dependencies |
| Repository | Git worktree detection and working tree state |
| Quality | Workflow, documentation and registered quality scripts |
| Security | Tracked `.env` detection and `.gitignore` protections |
| Dependencies | Wildcard or `latest` manifest ranges |
| Policy | Default policy and JSON schema presence |
| Provider | Presence of a supported credential source without reading its value |

A dirty working tree and wildcard dependencies are advisory by default. Missing runtimes, unreadable integrity checks, tracked credential files, missing contracts and missing CI assets block strict validation.

## Report contract

`schemaVersion` is incremented only for breaking report changes. Consumers should key automation by `checks[].id`, not by human-readable messages.

```json
{
  "schemaVersion": 1,
  "tool": {
    "name": "engineering-readiness",
    "version": "1.0.0"
  },
  "status": "ready | attention | blocked",
  "score": 0,
  "summary": {
    "total": 0,
    "pass": 0,
    "warn": 0,
    "fail": 0,
    "skip": 0,
    "strictBlockingWarnings": 0
  },
  "gate": {
    "strict": true,
    "passed": false,
    "exitCode": 1
  },
  "checks": [],
  "recommendations": []
}
```

Each check contains a stable identifier, category, status, severity, strict-blocker flag, score weight, message and—when useful—remediation and non-sensitive details.

## Privacy and secret handling

The gate checks only whether `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` exists. It never reads, hashes, truncates or serializes the value. It checks whether `~/.claude.json` exists but does not open the file.

Absolute project paths under the current home directory are redacted with `~`. Package parsing failures expose a bounded reason code instead of raw filesystem errors. Generated reports are written with owner-only permissions where the operating system supports POSIX modes and are ignored by Git.

## CI integration

`.github/workflows/quality-gate.yml` performs a frozen Bun install, runs both quality test suites, validates the policy contract, executes the strict gate, smoke-tests the CLI entrypoint and uploads JSON reports even when an earlier validation step fails.

The dependency-version check is currently advisory because the inherited manifest contains wildcard ranges while the committed `bun.lock` fixes the resolved graph. Moving those ranges to reviewed explicit constraints is tracked as a dedicated hardening phase rather than being mixed into this infrastructure change.

## Adding a check

1. Add a stable, namespaced identifier in `runReadiness`.
2. Emit the check on every execution path; use `skip` when the inspection is not applicable.
3. Mark inspection failures as strict warnings when a false pass would be unsafe.
4. Include only bounded, non-sensitive details.
5. Add tests for pass, failure and command-error behavior.
6. Update this catalogue and increment `schemaVersion` only when consumers must change.
