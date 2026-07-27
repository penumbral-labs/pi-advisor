import assert from "node:assert/strict";
import test from "node:test";
import { filterItems, fuzzyScore, isBackspace, isPrintable } from "../extensions/advisor/fuzzy.ts";

const items = [
	{ value: "openai:gpt-5", label: "GPT 5 (OpenAI)" },
	{ value: "anthropic:claude-opus", label: "Claude Opus (Anthropic)" },
	{ value: "anthropic:claude-sonnet", label: "Claude Sonnet (Anthropic)" },
];

test("fuzzyScore matches subsequences and rewards contiguous word matches", () => {
	assert.equal(fuzzyScore("zzz", "Claude Opus"), null);
	assert.ok(fuzzyScore("opus", "Claude Opus") > fuzzyScore("opus", "Odd Purple Usage Signal"));
});

test("filterItems searches label and colon-keyed value while retaining stable ties", () => {
	assert.equal(filterItems(items, "opus")[0].value, "anthropic:claude-opus");
	assert.deepEqual(filterItems(items, "anthropic").map((item) => item.value), ["anthropic:claude-opus", "anthropic:claude-sonnet"]);
	assert.equal(filterItems(items, ""), items);
});

test("picker input predicates distinguish printable input and backspace", () => {
	assert.equal(isBackspace("\u007f"), true);
	assert.equal(isBackspace("\b"), true);
	assert.equal(isPrintable("a"), true);
	assert.equal(isPrintable("\u001b"), false);
	assert.equal(isPrintable("ab"), false);
});
