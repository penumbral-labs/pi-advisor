# Advisor tool reference

The `advisor` tool asks the configured reviewer model for independent judgment and returns that guidance to the
executor. It is intended for decisions where a second model could materially improve the approach, not as a mandatory
lifecycle step.

## Input

```ts
advisor({
  stage?: "initial" | "recovery" | "final-check"
})
```

The input object and `stage` are optional.

| Stage         | Use                                                                              |
| ------------- | -------------------------------------------------------------------------------- |
| `initial`     | Review the intended approach before substantial implementation.                  |
| `recovery`    | Reassess after failures, uncertainty, or implementation that lacks verification. |
| `final-check` | Review implemented and verified work for remaining material issues.              |

Without an override, stage is inferred from recent reads, shell commands, mutations, verification commands, failures,
and prior advisor usage.

## Forwarded context

The extension constructs advisor context in this order:

1. build Pi's canonical session context for the current leaf;
2. convert resolved session messages into LLM messages;
3. remove the in-flight advisor tool call and its incomplete result;
4. curate to the configured message bound;
5. prepend stage, recent activity, and executor signals;
6. append a user request when needed so the advisor receives a valid user tail.

Curation preserves canonical compaction and branch summaries. It retains task framing and recent ordinary messages,
clamps long text, removes assistant tool-call blocks, and does not replay raw tool results. Tool inventory metadata is
included separately when tools are available.

Executor signals report the current phase, mutation count, verification commands, and recent failures. They are compact
summaries recorded by the extension, not raw tool output.

## Completion behavior

The resolved advisor model and effort come from the current executor mapping. Calls use Pi's model runtime completion
facade when the host provides it. That path keeps Pi's resolved authentication, headers, endpoint, and provider
behavior. Compatible hosts without the facade load `completeSimple` through `@earendil-works/pi-ai/compat`, or through
the package root when that export is unavailable, and receive the auth values resolved by Pi's model registry.

For LiteLLM-routed supported Claude models, the completion hook converts `reasoning_effort` into adaptive thinking and
an output effort value before the request is sent.

## Result

```ts
interface AdvisorDetails {
  advisorModel?: string;
  effort?: ThinkingLevel;
  usage?: Usage;
  stopReason?: StopReason;
  errorMessage?: string;
}

interface AdvisorResult {
  content: [{ type: "text"; text: string }];
  details: AdvisorDetails;
}
```

On success, `content[0].text` contains the advisor guidance. `advisorModel` is the colon-form resolved model stub.
`usage` and `stopReason` are copied from the provider response.

## Structured failures

The tool returns the same result envelope for expected failures:

| Condition                         | Behavior                                                               |
| --------------------------------- | ---------------------------------------------------------------------- |
| Per-run cap reached               | `errorMessage: "max_uses_exceeded"`; no completion request.            |
| No advisor mapping                | Explains that `/advisor` can enable one.                               |
| Model auth unavailable or invalid | Reports the model/provider auth diagnosis.                             |
| No canonical context              | `errorMessage: "no_context"`.                                          |
| Provider abort                    | Returns the abort stop reason and diagnostic.                          |
| Provider error                    | Returns the provider stop reason and error message.                    |
| Empty text response               | After one identical retry, returns `errorMessage: "empty response"`.   |
| Completion throws                 | Returns the thrown message without throwing through the tool boundary. |

The usage counter increments when a completion request is attempted. Model, auth, context, and compatibility-loader
failures release the reserved slot; provider aborts, errors, thrown completions, and empty responses consume it.
Configure `maxUsesPerRun` in `~/.pi/agent/pi-advisor.json` when a different cap is appropriate.
