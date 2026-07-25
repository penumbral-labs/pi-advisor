export const DEFAULT_PROMPT_SNIPPET =
  "Use a stronger reviewer only when independent judgment could materially change the approach. Optional stage: 'initial' | 'recovery' | 'final-check' (auto-detected when omitted)";

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
  "Use `advisor` selectively when independent judgment could materially change the approach: consequential ambiguity, competing architectural choices, repeated failure, conflicting evidence, or a significant change that genuinely benefits from independent review.",
  "Do not call `advisor` for routine reads, status checks, branch operations, straightforward edits, or merely because work is beginning or ending. Do not call it when the next action is already dictated by tool output or explicit user instructions.",
  "Usually make at most one advisor call per user request. Call again only when materially new evidence creates a different decision; do not use separate initial and final calls by default.",
  "Before an advisor call, make any current deliverable durable when practical. Afterward, weigh the advice against tool results and primary-source evidence rather than following it mechanically.",
  "If advisor guidance conflicts with strong evidence and the conflict blocks progress, one focused reconciliation call is appropriate. Otherwise, proceed using the evidence.",
  "Pass stage: 'initial' while choosing among consequential approaches, 'recovery' after repeated failure or conflicting evidence, and 'final-check' only when a significant completed change warrants independent review. Omit stage to let recent tool activity drive auto-detection.",
];
