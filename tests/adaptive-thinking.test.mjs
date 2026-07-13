import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLiteLLMAdaptiveThinkingPayload } from "../extensions/advisor/adaptive-thinking.ts";

function model(id, provider = "litellm") {
	return { id, provider };
}

test("rewrites Opus 4.8 reasoning_effort to adaptive thinking", () => {
	const payload = { model: "claude-opus-4-8", reasoning_effort: "high", messages: [] };
	const result = normalizeLiteLLMAdaptiveThinkingPayload(payload, model("claude-opus-4-8"));

	assert.deepEqual(result, {
		model: "claude-opus-4-8",
		messages: [],
		thinking: { type: "adaptive" },
		output_config: { effort: "high" },
	});
	assert.deepEqual(payload, { model: "claude-opus-4-8", reasoning_effort: "high", messages: [] });
});

test("maps minimal to the supported low effort", () => {
	const result = normalizeLiteLLMAdaptiveThinkingPayload(
		{ reasoning_effort: "minimal" },
		model("claude-sonnet-5"),
	);

	assert.deepEqual(result, {
		thinking: { type: "adaptive" },
		output_config: { effort: "low" },
	});
});

test("preserves existing output_config fields", () => {
	const result = normalizeLiteLLMAdaptiveThinkingPayload(
		{ reasoning_effort: "xhigh", output_config: { verbosity: "concise" } },
		model("claude-opus-4-8"),
	);

	assert.deepEqual(result, {
		thinking: { type: "adaptive" },
		output_config: { verbosity: "concise", effort: "xhigh" },
	});
});

test("ignores unaffected models and providers", () => {
	assert.equal(
		normalizeLiteLLMAdaptiveThinkingPayload({ reasoning_effort: "high" }, model("claude-opus-4-7")),
		undefined,
	);
	assert.equal(
		normalizeLiteLLMAdaptiveThinkingPayload(
			{ reasoning_effort: "high" },
			model("claude-opus-4-8", "anthropic"),
		),
		undefined,
	);
});

test("leaves requests without reasoning effort unchanged", () => {
	assert.equal(
		normalizeLiteLLMAdaptiveThinkingPayload({ messages: [] }, model("claude-opus-4-8")),
		undefined,
	);
});
