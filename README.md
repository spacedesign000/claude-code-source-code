# Claude Code

This repository is a source checkout of Claude Code that runs directly with [Bun](https://bun.sh). It is organized for direct development: application code lives under `src/`, operational scripts live under `scripts/`, repository configuration lives under `config/`, and maintainer docs live under `docs/`.

## Prerequisites

- **Bun 1.3.14** installed and on your `PATH` (pinned in `packageManager` for reproducible local and CI installs).
- **Node.js 20 or newer** for dependency-free quality and policy tooling.
- API access: **Anthropic** (`claude login`) or **OpenRouter** (see below).

## Repository layout

```text
.
├── .github/     Pull-request and delivery automation
├── config/      Versioned runtime and policy configuration
├── docs/        Maintainer, architecture and roadmap notes
├── public/      Static assets
├── scripts/     Local automation, validation and code generation
└── src/         Application source
```

Key source areas:

- `src/entrypoints/`: Bun entrypoints and SDK-facing contracts
- `src/cli/`: CLI transport and command wiring
- `src/commands/`: command implementations
- `src/components/`: Ink UI components
- `src/services/`: integrations and orchestration
- `src/tools/`: tool implementations and prompts
- `src/utils/`: shared infrastructure and helpers

See `docs/architecture.md` for the source tree map.

## Install and run

1. Clone the repository and enter the checkout:

   ```bash
   git clone https://github.com/spacedesign000/claude-code-source-code.git
   cd claude-code-source-code
   ```

2. Install the locked dependency graph:

   ```bash
   bun install --frozen-lockfile
   ```

3. Start the CLI from source (from this directory, or through a global link):

   ```bash
   bun src/entrypoints/cli.tsx
   ```

   Optional: a global **`claude-local`** command (the same CLI with additional local-development environment settings):

   ```bash
   bun link --global
   claude-local
   ```

There is no separate production build for day-to-day use: the entrypoint is `src/entrypoints/cli.tsx`. The shipped product is a different package; this repository runs directly from source.

## Engineering readiness

Run the human-readable environment and repository assessment:

```bash
bun run readiness
```

Machine-readable JSON and strict merge/release validation:

```bash
bun run readiness:json
bun run readiness:strict
```

Run the policy contract linter and both quality test suites:

```bash
bun run policy:lint
bun run test:readiness
bun run test:policy
```

Run the complete local quality gate after installing dependencies:

```bash
bun run check
```

The readiness gate never serializes provider secret values. CI writes `readiness-report.json` and `policy-report.json`, smoke-tests the CLI entrypoint and uploads the reports as workflow artifacts.

Detailed operating guides:

- `docs/engineering-readiness.md` — checks, JSON contract, strict behavior and CI usage
- `docs/policy-as-code.md` — policy profiles, invariants and runtime-integration plan
- `docs/roadmap.md` — phased product and engineering roadmap

## Common scripts

```bash
bun run cli
bun run check
node scripts/emit-core-types.mjs
node scripts/emit-control-types.mjs
```

## Validation

Minimal CLI smoke check:

```bash
bun run cli --help
```

The pull-request workflow performs a frozen install, quality tests, policy validation, the strict readiness gate and this smoke test.

## Fork workflow

1. Fork the repository.
2. Clone your fork.
3. Install Bun 1.3.14 and run `bun install --frozen-lockfile`.
4. Run `bun run check` before opening a pull request.
5. Start the CLI with `bun run cli`.
6. Keep code, policy contracts, automation and documentation synchronized when behavior changes.

---

## OpenRouter — set the API key from the CLI

The key is stored in Claude Code’s **global** config: `~/.claude.json` → `env`, together with the flag that routes traffic to OpenRouter.

### Save the API key (one-time)

Pick one approach (the binary is named `claude` in `--help`; from source use `bun src/entrypoints/cli.tsx` or `claude-local`):

```bash
# pass the key as an argument
bun src/entrypoints/cli.tsx auth openrouter set sk-or-v1-...

# or use OPENROUTER_API_KEY if it is already exported in your shell
bun src/entrypoints/cli.tsx auth openrouter set

# or pipe from stdin (handy for secrets)
echo "$OPENROUTER_API_KEY" | bun src/entrypoints/cli.tsx auth openrouter set --stdin
```

After a successful run, new sessions default to OpenRouter (`OPENROUTER_API_KEY` and `CLAUDE_CODE_USE_OPENROUTER=1` are written to config).

### Force Anthropic for a single session

```bash
bun src/entrypoints/cli.tsx --api-provider anthropic
```

### Remove the saved OpenRouter key from global config

```bash
bun src/entrypoints/cli.tsx auth openrouter clear
```

*(This only clears what is stored in `~/.claude.json` — not a key you export manually in the shell.)*

### Optional environment variables

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_BASE_URL` | Defaults to `https://openrouter.ai/api` |
| `OPENROUTER_HTTP_REFERER` | HTTP `Referer` for OpenRouter |
| `OPENROUTER_APP_TITLE` | App title sent to OpenRouter |

---

## Choosing a model in the CLI: `/model`

In an **interactive** session:

- **`/model`** — opens the interactive model picker.
- **`/model sonnet`**, **`/model opus`**, **`/model haiku`**, etc. — set the model by **alias** when your account/org allows it.
- **`/model default`** — revert to the default from your settings.

You can also pass a **full model id** for the active provider — with OpenRouter, ids look like their catalog (`anthropic/claude-sonnet-4.6`, `openai/gpt-4o`, …). What actually works depends on OpenRouter and any organization allowlist.

From the shell (before the REPL):

```bash
bun src/entrypoints/cli.tsx --api-provider openrouter --model anthropic/claude-sonnet-4.6
```

---

## Quick checklist

1. Install Bun 1.3.14.
2. Run `bun install --frozen-lockfile`.
3. Run `bun run check`.
4. Run `bun src/entrypoints/cli.tsx auth openrouter set <key>` *(or `claude login` for Anthropic)*.
5. Start `bun src/entrypoints/cli.tsx` and use **`/model`** inside the session to switch models.

If startup fails, confirm `bun --version` reports `1.3.14`, the strict readiness gate passes and your key is valid for the selected provider.
