# @penumbral-labs/pi-advisor

An advisor-strategy extension for [Pi](https://github.com/badlogic/pi-mono) with advisor model and reasoning effort
selected per executor model.

A fast executor can consult a stronger reviewer only when independent judgment could materially change the approach.
Switching Pi's primary model immediately resolves the matching advisor pairing, effort, and nudge sensitivity.

## Install

```bash
pi install git:github.com/penumbral-labs/pi-advisor
```

If the upstream package is installed, remove it first so only one extension registers the `advisor` command and tool:

```bash
pi remove npm:@juicesharp/rpiv-advisor
```

The package requires Node.js 22.6 or newer and uses the Pi runtime's installed peer dependencies.

## Configure per-executor pairings

1. Start Pi with the executor model you want to configure.
2. Run `/advisor`.
3. Select the executor, advisor model, reasoning effort, and nudge sensitivity.
4. Repeat for other executor models as needed.

The first advisor selection also seeds the default fallback when no default exists. Selecting **No advisor** removes the
chosen executor's mapping; if a default remains, that executor falls back to it.

A model switch during a session re-resolves the mapping immediately. If the mapping is missing, malformed, or points to
an unavailable model, Pi clears stale advisor state and removes the tool from the active set.

## Use the advisor

Pi may call the tool when its judgment could materially improve the plan, recovery, or final review. You can also ask Pi
to consult it explicitly.

```ts
advisor(); // stage inferred from executor activity
advisor({ stage: "initial" });
advisor({ stage: "recovery" });
advisor({ stage: "final-check" });
```

The advisor receives a bounded, curated view of Pi's canonical conversation context. Compaction and branch summaries are
preserved, while tool-call blocks, raw tool results, and excess transcript text are omitted or clamped. The request also
includes the inferred or explicit stage, recent tool activity, mutation count, verification commands, and recent
failures.

Calls use Pi's auth-aware model runtime when available, preserving provider auth and endpoint resolution. Compatible
older hosts load `completeSimple` through Pi's compatibility entrypoint. LiteLLM adaptive-thinking payloads are
normalized for supported Claude models on both paths.

## Automatic nudges

The extension can inject a short suggestion to consult the advisor after:

- the first mutation following enough exploratory reads or shell commands;
- a configured burst of edits and writes; or
- a long run of tool calls.

Nudges are suggestions, not advisor calls. At most one fires per run, session-level backoff suppresses follow-up
micro-turns, and an actual advisor call suppresses later nudges in that run. The `/advisor` picker offers:

| Preset    | Pre-execution | Mutation burst | Long run | Backoff |
| --------- | ------------: | -------------: | -------: | ------: |
| `heavy`   |            on |              2 |        8 |      10 |
| `default` |            on |              4 |       15 |      20 |
| `light`   |           off |              8 |       30 |      40 |
| `off`     |      disabled |              — |        — |       — |

`quietPaths` silences only automatic nudges for matching working directories. Manual and model-initiated advisor calls
remain available.

## Config

Configuration is stored only at:

```text
~/.pi/agent/pi-advisor.json
```

Model stubs are always colon-delimited `<provider>:<modelId>` strings:

```json
{
  "default": {
    "modelStub": "anthropic:claude-opus-4-7",
    "effort": "high"
  },
  "byExecutor": {
    "anthropic:claude-sonnet-4-6": {
      "modelStub": "anthropic:claude-opus-4-7",
      "effort": "xhigh",
      "nudge": {
        "preExecution": false,
        "mutationBurst": 8,
        "longRunToolCalls": 30,
        "backoffToolCalls": 40
      }
    }
  },
  "maxUsesPerRun": 5,
  "maxContextMessages": 18,
  "quietPaths": ["~/work-os/**"]
}
```

Resolution order is `byExecutor[<provider>:<modelId>]`, then `default`. Nudge settings merge in the order built-in
defaults, top-level `nudge`, then the resolved executor entry's `nudge`.

See [Configuration](docs/configuration.md) for every field and merge rule.

## Tool result

The tool returns Pi's standard text content plus structured details:

```ts
{
  content: [{ type: "text", text: string }],
  details: {
    advisorModel?: string,
    effort?: ThinkingLevel,
    usage?: Usage,
    stopReason?: StopReason,
    errorMessage?: string
  }
}
```

Failures such as no mapping, unavailable auth, no context, cancellation, empty output, provider errors, thrown errors,
and the per-run usage cap are returned in this envelope rather than escaping as unstructured exceptions.

See [Tool reference](docs/tool-reference.md) for stages, context policy, and error behavior.

## Troubleshooting

### `/advisor` is missing

Run `pi list` and confirm this package is enabled. Remove another advisor extension if both register the same command,
then restart Pi.

### The advisor tool is inactive

Run `/advisor` for the current executor. Confirm both the executor map key and `modelStub` use `<provider>:<modelId>`
and that the advisor model appears in Pi's model picker. A missing or unavailable resolved model intentionally disables
the tool.

### The advisor reports an auth error

Configure the advisor provider through Pi's normal login or provider configuration. The extension uses Pi's resolved
auth and request routing; it does not store provider credentials.

### Changes do not save

The picker reports config write failures instead of claiming success. Verify that `~/.pi/agent` exists or can be created
and that your user can write `pi-advisor.json`.

### Nudges are too frequent or absent

Choose a different preset in `/advisor`, or inspect top-level and per-executor `nudge` values. Also check `quietPaths`,
`maxUsesPerRun`, and whether an advisor call already happened in the current run.

## Development

```bash
npm test
pi -e ./extensions/advisor/index.ts
```

`npm test` includes package-content verification and an isolated user-perspective Pi loader smoke test with a
deterministic completion provider. The smoke test does not read or modify the normal user config.

## Credits

Forked from [`@juicesharp/rpiv-advisor`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-advisor) v1.5.2
by [juicesharp](https://github.com/juicesharp). This fork preserves the advisor-strategy design while adding
per-executor mappings and the documented context, usage, and nudge behavior.

## License

MIT
