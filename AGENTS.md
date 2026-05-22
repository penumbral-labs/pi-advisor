# @penumbral-labs/pi-advisor — Agent Instructions

Pi extension implementing the advisor-strategy pattern with **per-executor advisor mapping**.

## What this is

Forked from [`@juicesharp/rpiv-advisor`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-advisor)
v1.5.2. The upstream standalone repo (`juicesharp/rpiv-advisor`) is archived; active development moved to
`juicesharp/rpiv-mono`. See **Upstream** below.

The one thing this fork adds that the upstream doesn't have: the advisor model and reasoning effort are keyed by the
**current executor model**, so they swap automatically when you switch primary models. That's the core reason this fork
exists.

## Codebase layout

```
extensions/advisor/
  index.ts          — Extension entrypoint; session_start + model_select handlers
  advisor.ts        — Tool registration, /advisor command, per-executor config R/W
  advisor-ui.ts     — TUI panels (model picker, effort picker)
  prompts/
    advisor-system.txt — System prompt injected into the advisor call
```

Config lives at `~/.pi/agent/pi-advisor.json` — colocated with other pi-plugin config, default 0644 perms (no
credentials; only model identifiers and effort strings).

## Upstream: treat as citation-only

The `upstream` remote points to `git@github.com:juicesharp/rpiv-mono.git`, but **do not `git merge` or `git pull` it**.
The upstream is a monorepo; the relevant package lives under `packages/rpiv-advisor/` and pulling wholesale would dump
unrelated packages and scaffolding into this repo.

When upstream changes are worth incorporating:

```bash
git fetch upstream
git log upstream/main -- packages/rpiv-advisor   # find relevant commits
git cherry-pick <sha>                             # port selectively
```

Or to apply a whole batch:

```bash
git diff HEAD upstream/main -- packages/rpiv-advisor  # review delta
git checkout upstream/main -- packages/rpiv-advisor/  # apply wholesale
git commit
```

The upstream is there for reference and cherry-picking only. If there's nothing relevant in `packages/rpiv-advisor`,
ignore it.

## Known gaps worth filling (backport candidates)

Two things from [`RimuruW/pi-advisor`](https://github.com/RimuruW/pi-advisor) are better than ours:

1. **Transcript curation** (`src/advisor-messages.ts`) — strips tool results, clamps long blocks, retains first+last N
   messages, adds executor signals block. Makes advisor calls significantly cheaper and more focused. Worth porting
   directly.

2. **`shouldNudge` + `maxUsesPerRun`** — status bar hint that fires when code has changed but tests haven't run; per-run
   usage cap. Low-effort quality-of-life add.

Do not blindly merge their `index.ts` — it collapses everything into one file and drops the per-executor mapping
entirely. Port the modules, not the entrypoint.

## Dev notes

- `peerDependencies` are not bundled; they come from the Pi install that loads this extension.
- No build step — Pi loads `.ts` files directly via the `"pi"."extensions"` field in `package.json`.
- Test with `pi install git:github.com/penumbral-labs/pi-advisor` or `pi -e ./extensions/advisor/index.ts`.
