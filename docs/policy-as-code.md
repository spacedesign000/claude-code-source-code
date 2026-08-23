# Policy as Code

## Status

The first policy-as-code increment is implemented as a versioned contract, secure default profiles, a JSON Schema and a dependency-free linter. It establishes the configuration boundary that runtime permission enforcement will consume in the next increment.

This release validates policy files but does **not yet replace** the application's existing permission engine. Until runtime integration is complete, the policy must be treated as a reviewed contract rather than a security boundary by itself.

## Files

| Path | Purpose |
| --- | --- |
| `config/policies/default.json` | Reviewed default policy with `safe`, `balanced` and `autonomous` profiles |
| `config/policies/schema.json` | JSON Schema Draft 2020-12 contract for editors and external tooling |
| `scripts/policy-lib.mjs` | Parser, semantic validation and baseline safety invariants |
| `scripts/policy-lint.mjs` | Human/JSON CLI with stable exit codes |
| `scripts/policy-lint.test.mjs` | Regression tests for contract and mandatory guards |

## Profiles

### `safe`

Optimized for review-heavy work. Read-only discovery commands are allowed; mutations, shell activity and tool use generally require confirmation. Network access is denied except for the declared model-provider hosts.

### `balanced`

The default profile. Project-local edits inside reviewed write scopes are allowed, while shell commands and network tools remain confirmation-oriented. Credential paths, Git metadata and private network ranges remain denied.

### `autonomous`

Optimized for high-throughput implementation inside the repository. It deliberately carries linter warnings because project-wide writes, unmatched shell commands and unmatched tools are permissive. Baseline credential guards, destructive-command denials, project-boundary protection and network allowlists remain mandatory.

## Validation

Run the default policy linter:

```bash
bun run policy:lint
```

Produce JSON:

```bash
bun run policy:lint:json
```

Validate another file and save a report:

```bash
node scripts/policy-lint.mjs ./policy.json --output policy-report.json
```

Exit codes are `0` for a valid policy, `1` for validation errors and `2` for usage or execution errors. Warnings do not fail validation; they make intentionally permissive choices visible to reviewers and telemetry.

## Mandatory invariants

The semantic validator supplements JSON Schema with safety rules that are difficult to express clearly as structural constraints:

- access outside the project may not default to `allow`;
- `.env`, Git metadata and SSH credentials must be covered by deny rules;
- private network ranges must remain denied;
- shell profiles must define explicit deny rules;
- bare wildcard shell or network allow rules are rejected;
- unknown properties are rejected, preventing silent behavior changes on misspelled keys;
- duplicate values and duplicate tool rules are rejected.

The linter reports paths and bounded findings only. It does not echo policy contents, which reduces accidental exposure if future policy files reference sensitive internal hosts or paths.

## Evaluation model for runtime integration

The planned runtime evaluator will apply the following precedence:

1. immutable platform guardrails;
2. explicit deny rules;
3. the most specific matching tool/path/command/host rule;
4. profile default decision;
5. confirmation fallback for malformed or ambiguous requests.

Every decision will return a structured explanation containing the selected profile, matched rule, source file and final decision. This enables UI explanations, audit logs and deterministic tests without logging sensitive command payloads.

## Next implementation increment

The next change will connect this contract to the existing permission context behind an opt-in feature flag. It will add compiled policy snapshots, path normalization, command tokenization, host normalization, decision traces and parity tests against the current permission engine before any profile can become the default runtime authority.
