# @penumbral-labs/pi-advisor — Agent Instructions

Pi extension implementing the advisor-strategy pattern with **per-executor advisor mapping**.

## What this is

Forked from [`@juicesharp/rpiv-advisor`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-advisor)
v2.1.0. The upstream standalone repo (`juicesharp/rpiv-advisor`) is archived; active development moved to
`juicesharp/rpiv-mono`. See **Upstream** below.

The one thing this fork adds that upstream does not have is that the advisor model, reasoning effort, and nudge policy
are keyed by the **current executor model**, so they swap automatically when Pi switches primary models.

## Codebase layout

```text
extensions/advisor/
  index.ts                    — package entrypoint and lifecycle wiring
  advisor-ui.ts               — filterable TUI panels
  adaptive-thinking.ts        — LiteLLM adaptive-thinking normalization
  guidance.ts                 — default selective-consultation guidance
  fuzzy.ts                    — picker filtering
  advisor/
    command.ts                — `/advisor` per-executor configuration flow
    config.ts                 — config schema, validation, and atomic persistence
    context.ts                — canonical-context cleanup
    curation.ts               — bounded transcript curation entrypoint
    execute.ts                — auth-aware advisor completion and result envelope
    execution-context.ts      — stage inference and recent tool signals
    handlers.ts               — active-tool and model-switch reconciliation
    inventory.ts              — bounded executor tool inventory
    messages-curation.ts      — transcript trimming and summary retention
    messages.ts               — shared constants and user-facing strings
    nudges.ts                 — automatic nudge policy and run tracking
    pi-compat.ts              — runtime completion and compatibility fallback
    prompt.ts                 — advisor system prompt loading
    register.ts               — advisor tool registration
    restore.ts                — per-executor mapping restoration
    state.ts                  — in-memory selection state
  prompts/
    advisor-system.txt        — system prompt injected into advisor calls
```

Config lives at `~/.pi/agent/pi-advisor.json`. It contains model identifiers and behavior settings, not credentials, so
normal user umask permissions are appropriate.

## Upstream: treat as citation-only

The `upstream` remote points to `git@github.com:juicesharp/rpiv-mono.git`, but **do not `git merge` or `git pull` it**.
The upstream is a monorepo; the relevant package lives under `packages/rpiv-advisor/`, and merging wholesale would
import unrelated packages and scaffolding.

Inspect and port relevant upstream work selectively:

```bash
git fetch upstream
git log upstream/main -- packages/rpiv-advisor
git show <sha> -- packages/rpiv-advisor
git diff <old-upstream-ref>..upstream/main -- packages/rpiv-advisor
```

Adapt patches to this fork's standalone layout and preserve per-executor mappings, local config shape, context curation,
execution signals, LiteLLM normalization, and nudge behavior. Do not copy upstream's entrypoint or package wholesale.

## Current divergence from upstream

This fork intentionally retains:

- per-executor advisor model, effort, and nudge mappings;
- `~/.pi/agent/pi-advisor.json` with colon-form `<provider>:<modelId>` keys;
- bounded transcript curation with executor signals;
- judgment-based guidance and quiet-path-aware automatic nudges;
- LiteLLM adaptive-thinking normalization;
- standalone packaging and Node test harness.

Upstream fixes should be evaluated for behavior, not counted via repository-wide ahead/behind numbers. The repositories
have unrelated histories, and the upstream remote includes the entire `rpiv-mono` monorepo.

## Dev notes

- `peerDependencies` are not bundled; they come from the Pi installation that loads this extension.
- Pi loads the TypeScript sources directly through the `package.json` `pi.extensions` entry; there is no compile step.
- Run `npm test` for focused tests, package verification, and the isolated Pi loader smoke test.
- Run `npm pack --dry-run` to inspect the distributable file set.
- Smoke test locally with `pi -e ./extensions/advisor/index.ts` when interactive behavior changes.
