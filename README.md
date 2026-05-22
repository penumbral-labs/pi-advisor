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

Existing `~/.config/rpiv-advisor/advisor.json` (or an interim
`~/.config/pi-advisor/advisor.json`) is migrated to `~/.pi/agent/pi-advisor.json`
on first load and treated as the default. Legacy files are left in place.

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
  "default": { "modelKey": "anthropic:claude-opus-4-7", "effort": "xhigh" },
  "byExecutor": {
    "anthropic:claude-sonnet-4-6":  { "modelKey": "anthropic:claude-opus-4-7", "effort": "xhigh" },
    "llm-router:azure/gpt-5.5":     { "modelKey": "google:gemini-3-pro",       "effort": "high"  },
    "google:gemini-3-pro":          { "modelKey": "anthropic:claude-opus-4-7", "effort": "high"  }
  }
}
```

Resolution order for the active executor:

1. `byExecutor[<provider>:<modelId>]`, if present and has `modelKey`.
2. `default`, if present and has `modelKey`.
3. Legacy top-level `{modelKey, effort}` (read-only back-compat for migrated configs).

If nothing resolves, the advisor is disabled.

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
