# Configuration

`@penumbral-labs/pi-advisor` reads and writes one JSON file:

```text
~/.pi/agent/pi-advisor.json
```

The file contains model identifiers, behavior settings, and prompt guidance. Provider credentials remain under Pi's
normal authentication system.

## Complete example

```json
{
  "default": {
    "modelStub": "anthropic:claude-opus-4-7",
    "effort": "high",
    "nudge": {
      "preExecution": true,
      "mutationBurst": 4,
      "longRunToolCalls": 15,
      "backoffToolCalls": 20
    }
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
  "guidance": {
    "promptSnippet": "Consult the advisor when independent judgment could materially change the approach.",
    "promptGuidelines": ["Use advisor selectively for consequential planning, recovery, or final verification."]
  },
  "maxUsesPerRun": 5,
  "maxContextMessages": 18,
  "nudge": {
    "preExecutionMinExploration": 3
  },
  "quietPaths": ["~/work-os/**"]
}
```

## Model entries

Both `default` and values under `byExecutor` use this shape:

| Field       | Type   | Meaning                                                                              |
| ----------- | ------ | ------------------------------------------------------------------------------------ |
| `modelStub` | string | Advisor model as `<provider>:<modelId>`.                                             |
| `effort`    | string | Pi thinking level used for advisor completion. Omit for no explicit reasoning level. |
| `nudge`     | object | Nudge overrides for this resolved entry.                                             |

`byExecutor` keys also use `<provider>:<modelId>`. The model ID may itself contain `/`; the first colon separates the
provider from the complete model ID.

For the active executor, resolution is:

1. `byExecutor[<provider>:<modelId>]` when it contains a `modelStub`;
2. `default` when it contains a `modelStub`;
3. disabled when neither resolves.

The `/advisor` command preserves unrelated top-level fields when saving. Its first successful selection seeds `default`
if no default exists. Removing an executor-specific entry reveals the default fallback, if configured.

## Usage and context limits

| Field                | Default | Meaning                                                                     |
| -------------------- | ------: | --------------------------------------------------------------------------- |
| `maxUsesPerRun`      |     `5` | Maximum advisor tool calls in one agent run.                                |
| `maxContextMessages` |    `18` | Transcript window size before curation adds retained summaries and framing. |

A usage-cap rejection is returned as a structured tool result. Context starts from Pi's resolved session branch before
curation, so compaction and branch summaries remain available even when older ordinary messages are windowed out.

## Nudge settings

Top-level `nudge` values apply globally. A resolved model entry's `nudge` values override them. The merge order is:

1. built-in defaults;
2. top-level `nudge`;
3. resolved entry `nudge`.

| Field                        | Default | Meaning                                               |
| ---------------------------- | ------: | ----------------------------------------------------- |
| `disabled`                   | `false` | Disable automatic nudges.                             |
| `preExecution`               |  `true` | Nudge on the first mutation after enough exploration. |
| `preExecutionMinExploration` |     `3` | Required earlier `read` or `bash` calls.              |
| `mutationBurst`              |     `4` | Nudge at exactly this many `edit` or `write` calls.   |
| `longRunToolCalls`           |    `15` | Nudge at exactly this many non-advisor tool calls.    |
| `backoffToolCalls`           |    `20` | Session tool calls required since the last nudge.     |

The picker writes `heavy`, `default`, `light`, and `off` presets. A run emits at most one automatic nudge, and an actual
advisor call suppresses a later nudge in the same run.

## Quiet paths

`quietPaths` is an array of directories where automatic nudges are silenced. Matching:

- expands a leading `~` to the home directory;
- accepts an optional trailing `/` or `/**`;
- is segment-aware, so `~/work-os` matches `~/work-os/wiki` but not `~/work-os-2`.

Quiet paths do not disable the advisor tool.

## Guidance overrides

`guidance.promptSnippet` replaces the short tool prompt snippet. `guidance.promptGuidelines` replaces the guideline
array. Invalid or empty values are ignored and built-in selective-consultation guidance is used instead.

Use guidance overrides to tune when the executor considers consultation. They do not alter the advisor system prompt,
context pipeline, or model mapping.

## Save and parse behavior

- Missing files load as an empty config.
- Malformed JSON and non-object JSON load as an empty config; malformed JSON emits a path-only diagnostic.
- Saves create the parent directory and return success or failure to the command UI.
- File permissions follow the normal user umask because the file does not contain provider credentials.
