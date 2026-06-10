# @penumbral-labs/pi-advisor

Per-executor advisor selection for [Pi Agent](https://github.com/badlogic/pi-mono). Forked from
[`@juicesharp/rpiv-advisor`](https://www.npmjs.com/package/@juicesharp/rpiv-advisor) — same
advisor-strategy pattern, but the advisor model and reasoning effort are keyed by the **current
primary/executor model** so they swap automatically when you change models.

## Why

If you switch primary models often, a single hard-coded advisor isn't always the right pairing. With
this fork:

- Run Sonnet → advisor is Opus.
- Switch to GPT-5.5 → advisor swaps to Gemini 3 Pro.
- Switch to Gemini 3 Pro → advisor swaps to Opus.

You configure each pairing once with `/advisor`; the rest is automatic.

## Install

```bash
pi remove npm:@juicesharp/rpiv-advisor   # if installed
pi install git:github.com/penumbral-labs/pi-advisor
```

This is a clean fork: existing `~/.config/rpiv-advisor/advisor.json` is
ignored. Run `/advisor` once after install to set up your pairings.

## Usage

- `/advisor` — picks an advisor model (and reasoning effort, when applicable) for the **current
  executor**. Selection is saved under that executor's key. If no global default exists yet, the
  first selection also seeds the default so other executors get a sane fallback until they're
  configured individually.
- Switching executor mid-session triggers an automatic re-resolution and (if needed) a swap.
- "No advisor" disables the advisor for the current executor only.

The `advisor` tool is registered at load but excluded from active tools whenever no advisor is
selected for the current executor. It takes zero parameters — calling it forwards the full
serialized conversation branch to the resolved advisor model.

## Config schema

`~/.pi/agent/pi-advisor.json` (colocated with other pi-plugin config; default
0644 perms — the file contains model identifiers and effort strings, no
credentials):

```json
{
  "default": { "modelStub": "anthropic:claude-opus-4-7", "effort": "xhigh" },
  "byExecutor": {
    "anthropic:claude-sonnet-4-6":  { "modelStub": "anthropic:claude-opus-4-7", "effort": "xhigh" },
    "llm-router:azure/gpt-5.5":     { "modelStub": "google:gemini-3-pro",       "effort": "high"  },
    "google:gemini-3-pro":          { "modelStub": "anthropic:claude-opus-4-7", "effort": "high"  }
  }
}
```

`modelStub` and the `byExecutor` map keys are both `<provider>:<modelId>`
strings. Named `Stub` rather than `Key` so corporate Semgrep doesn't false-flag
them as credentials.

Resolution order for the active executor:

1. `byExecutor[<provider>:<modelId>]`, if present and has `modelStub`.
2. `default`, if present and has `modelStub`.

If nothing resolves, the advisor is disabled.

## Automatic nudges

Beyond on-demand `advisor()` calls, the extension injects a one-line "consider calling advisor"
hint when tool activity crosses a threshold. Three triggers, in priority order:

1. **Pre-execution** — the first `edit`/`write` after `preExecutionMinExploration` (default 3)
   read/bash calls. This is the noisiest trigger: any read-then-write session fires it.
2. **Mutation burst** — exactly the `mutationBurst`th (default 4) mutation.
3. **Long run** — exactly the `longRunToolCalls`th (default 15) total tool call.

`backoffToolCalls` (default 20) is the minimum session-level tool calls between nudges.

Pick sensitivity per executor in `/advisor`, or hand-edit a `nudge` block. The presets:

| Preset    | preExecution | mutationBurst | longRunToolCalls | backoffToolCalls |
| --------- | ------------ | ------------- | ---------------- | ---------------- |
| `heavy`   | on           | 2             | 8                | 10               |
| `default` | on           | 4             | 15               | 20               |
| `light`   | **off**      | 8             | 30               | 40               |
| `off`     | — (`disabled: true`) | | | |

`preExecution: false` keeps the burst/long-run safety nets but drops trigger 1 — the right shape
for strong models that don't need pre-write hand-holding. `nudge` merges over the top-level `nudge`
over `DEFAULT_NUDGE_CONFIG`, so any subset of keys is valid.

`quietPaths` (top level) silences **all** automatic nudges when the session cwd falls under a listed
directory — for home-base / non-coding trees like an Obsidian vault — regardless of executor. The
`advisor()` tool stays callable on demand. Trailing `/**` or `/` is optional; a leading `~` expands
to the home directory; matching is segment-aware (`~/work-os` matches `~/work-os/wiki`, not
`~/work-os-2`).

```json
{
  "quietPaths": ["~/work-os/**"],
  "byExecutor": {
    "anthropic:claude-opus-4-8": {
      "modelStub": "llm-router:azure/gpt-5.5",
      "effort": "xhigh",
      "nudge": { "preExecution": false, "mutationBurst": 8, "longRunToolCalls": 30, "backoffToolCalls": 40 }
    }
  }
}
```

## Tool

```ts
advisor() // zero parameters
```

Returns:

```ts
{
  content: [{ type: "text", text: string }], // reviewer's guidance, or error message
  details: {
    advisorModel?: string,        // "<provider>:<modelId>"
    effort?: ThinkingLevel,
    usage?: Usage,
    stopReason?: StopReason,
    errorMessage?: string,
  }
}
```

## Credits

Forked from [`@juicesharp/rpiv-advisor`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-advisor)
v1.5.2 by [juicesharp](https://github.com/juicesharp). Original design — advisor-strategy pattern,
zero-parameter handoff, tool-inventory cache parity, in-flight-call stripping, user-tail nudge — is
unchanged. This fork adds executor-keyed configuration, a `model_select` event handler, and a
config-path rebrand.

## License

MIT
