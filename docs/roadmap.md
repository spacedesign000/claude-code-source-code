# Product and Engineering Roadmap

## North star

Evolve the local source checkout into a reliable agent-development platform: safe by default, observable, reproducible, provider-independent and suitable for individual as well as team workflows. Each phase must deliver a testable vertical slice rather than an isolated UI surface.

## Delivery principles

- Security decisions are explicit, versioned and explainable.
- Headless automation and stable contracts precede visual controls.
- Every autonomous capability ships with replay tests, budgets and rollback paths.
- Provider-specific behavior is isolated behind adapters.
- Telemetry is privacy-filtered at collection time, not after export.
- Supply-chain provenance is verified before plugins, skills or updates execute.

## Phase 0 — Engineering readiness gate

**Status: implemented in this change.**

Outcomes:

- deterministic local and CI readiness checks;
- stable JSON report and exit-code contract;
- frozen runtime/tooling expectations;
- tests for false-positive prevention and secret non-disclosure;
- pull-request workflow with archived reports and CLI smoke test.

Acceptance criteria:

- quality unit tests pass;
- strict mode blocks missing runtimes, missing contracts, tracked credentials and failed integrity inspections;
- CI emits a report even on validation failure;
- provider secret values never enter a report.

## Phase 1 — Policy-as-code permission engine

**Status: started. Contract, profiles, JSON Schema and linter are implemented in this change. Runtime enforcement remains next.**

Planned vertical slices:

1. Compile versioned policy files into immutable runtime snapshots.
2. Normalize filesystem paths, shell commands, tool names and network hosts before matching.
3. Add explainable `allow`, `confirm` and `deny` decisions with matched-rule traces.
4. Integrate behind an opt-in flag with parity tests against the current permission context.
5. Add per-project overrides with enterprise-level immutable guardrails.
6. Surface the active profile and decision explanation in the CLI.

Acceptance criteria:

- malformed or ambiguous policy input fails closed;
- explicit deny rules always win;
- path traversal, symlink escape, shell-wrapper and host-normalization test suites pass;
- every permission decision is reproducible from a redacted audit record;
- switching profiles does not require application restart.

Primary risks:

- semantic drift between shell parsing and actual execution;
- platform-specific path behavior;
- policy complexity that makes user expectations harder to predict.

Mitigation: tokenized command evaluation, canonical paths, small rule vocabulary, golden decision fixtures and a shadow-evaluation period before enforcement.

## Phase 2 — Replay and evaluation harness

Build deterministic regression testing for prompts, tools and multi-step agent workflows.

Outcomes:

- versioned task fixtures with repository snapshots;
- recorded tool-result replays without external side effects;
- assertions for final state, forbidden actions, token/cost budgets and latency;
- comparison scorecards across models, prompts and policy profiles;
- flake detection and quarantined benchmark cases.

Acceptance criteria:

- the same fixture can run live or from replay;
- nondeterministic fields are normalized explicitly;
- CI reports quality regressions against a reviewed baseline;
- failed cases include a compact decision/tool timeline.

Dependencies: policy decision traces and stable tool-call serialization.

## Phase 3 — Privacy-first observability

Instrument sessions with OpenTelemetry-compatible traces, metrics and bounded logs.

Core signals:

- model latency, time to first token, retries and provider errors;
- tool success rate, duration, cancellation and permission decision;
- context growth, compaction events and cache behavior;
- token usage, estimated cost and budget exhaustion;
- replay/evaluation score by version and profile.

Acceptance criteria:

- redaction occurs before data leaves process memory;
- telemetry can be disabled globally and per project;
- local JSON and OTLP exporters share the same schema;
- high-cardinality or secret-like attributes are rejected by tests.

## Phase 4 — Provider and model gateway

Create a policy-aware gateway across Anthropic, OpenRouter, Bedrock and future providers.

Capabilities:

- provider health checks and circuit breakers;
- model capability registry and compatibility validation;
- cost, latency and data-residency routing policies;
- bounded fallback chains with idempotency protection;
- per-session and per-organization budgets;
- approved-model allowlists and deprecation windows.

Acceptance criteria:

- fallback cannot duplicate a side-effecting tool step;
- routing decisions are explainable and observable;
- provider credentials remain isolated by adapter;
- budget exhaustion produces a controlled stop, not silent model downgrade.

## Phase 5 — Team workspace and governance

Add shared, reviewable operating controls without weakening local workflows.

Capabilities:

- organization policy inheritance and project exceptions;
- roles for policy owners, operators and reviewers;
- shared skills, MCP catalogs and approved model sets;
- session handoff, review checkpoints and signed approvals;
- searchable, redacted audit trail with retention controls.

Acceptance criteria:

- local overrides cannot weaken immutable organization denials;
- every policy/skill change has provenance and review status;
- access revocation is reflected in active sessions within a bounded interval.

## Phase 6 — Signed plugin and skill supply chain

Harden extension discovery, installation and execution.

Capabilities:

- checksums, signatures and publisher identity;
- declared permissions and dependency inventory;
- quarantine execution for first use and updates;
- vulnerability/advisory ingestion;
- reproducible extension bundles and rollback.

Acceptance criteria:

- unsigned or modified artifacts cannot execute in enforced mode;
- permission expansion requires explicit review;
- compromised publisher keys can be revoked without a client release.

## Phase 7 — Control plane and remote sessions

Introduce desktop/web operational surfaces only after contracts, policy and telemetry are stable.

Capabilities:

- remote session inventory and health;
- queued approvals with decision context;
- budget, model and policy controls;
- task handoff between devices;
- incident-safe session suspension and evidence export.

Acceptance criteria:

- remote commands are authenticated, authorized and replay-protected;
- approval UX displays the normalized action and matched policy rule;
- control-plane outages do not bypass local safety controls.

## Immediate backlog

The next implementation branch should focus on Phase 1 runtime integration in this order:

1. `PolicySnapshot` and `PolicyDecision` TypeScript contracts.
2. Pure path/tool/host evaluators with golden fixtures.
3. Shell command tokenizer and deny-rule matcher.
4. Shadow-mode adapter in the existing permission context.
5. Redacted decision trace surfaced in diagnostics.
6. Feature-flagged enforcement for the `safe` profile.

The replay harness should begin as soon as the first pure evaluators exist, so policy behavior is protected before runtime adoption expands.
