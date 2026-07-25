import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PROMPT_GUIDELINES, DEFAULT_PROMPT_SNIPPET } from "../extensions/advisor/guidance.ts";

test("default guidance makes advisor consultation judgment-based", () => {
  const guidance = DEFAULT_PROMPT_GUIDELINES.join("\n");

  assert.match(DEFAULT_PROMPT_SNIPPET, /only when independent judgment could materially change the approach/i);
  assert.match(guidance, /Do not call `advisor` for routine reads, status checks, branch operations/i);
  assert.match(guidance, /Usually make at most one advisor call per user request/i);
  assert.match(guidance, /do not use separate initial and final calls by default/i);
  assert.doesNotMatch(guidance, /Call `advisor` BEFORE substantive work/);
  assert.doesNotMatch(guidance, /Also call `advisor` when you believe the task is complete/);
});
