import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
	ADVISOR_CONFIG_PATH,
	loadJsonConfig,
	modelStubOf,
	parseModelStub,
	resolveAdvisorEntry,
	saveJsonConfig,
	updateAdvisorConfig,
	validateAdvisorEffort,
	validateGuidanceFields,
} from "../extensions/advisor/advisor/config.ts";

function withTempDir(fn) {
	const directory = mkdtempSync(join(tmpdir(), "pi-advisor-config-"));
	try {
		return fn(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("uses only the approved pi-agent config path", () => {
	assert.match(ADVISOR_CONFIG_PATH, /[/\\]\.pi[/\\]agent[/\\]pi-advisor\.json$/);
	assert.doesNotMatch(ADVISOR_CONFIG_PATH, /\.config|rpiv-advisor/);
});

test("loads missing config as an empty object", () =>
	withTempDir((directory) => {
		assert.deepEqual(loadJsonConfig(join(directory, "missing.json")), {});
	}));

test("rejects non-object JSON roots", () =>
	withTempDir((directory) => {
		for (const [index, value] of [null, "text", 42, true, [1, 2, 3]].entries()) {
			const path = join(directory, `${index}.json`);
			writeFileSync(path, JSON.stringify(value), "utf8");
			assert.deepEqual(loadJsonConfig(path), {});
		}
	}));

test("diagnoses malformed JSON without including file contents", () =>
	withTempDir((directory) => {
		const path = join(directory, "config.json");
		const sensitiveText = "private-value-that-must-not-leak";
		writeFileSync(path, `{${sensitiveText}`, "utf8");
		const warnings = [];
		const originalWarn = console.warn;
		console.warn = (message) => warnings.push(String(message));
		try {
			assert.deepEqual(loadJsonConfig(path), {});
		} finally {
			console.warn = originalWarn;
		}
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /invalid JSON.*using empty config/i);
		assert.doesNotMatch(warnings[0], new RegExp(sensitiveText));
	}));

test("round-trips the complete config without changing colon keys or unknown fields", () =>
	withTempDir((directory) => {
		const path = join(directory, "nested", "pi-advisor.json");
		const fixture = {
			default: { modelStub: "anthropic:claude-opus", effort: "high" },
			byExecutor: {
				"openai:gpt-5": {
					modelStub: "anthropic:claude-sonnet",
					effort: "medium",
					nudge: { mutationBurst: 2 },
				},
			},
			nudge: { preExecution: true, longRunToolCalls: 15 },
			quietPaths: ["~/work-os/wiki/**"],
			maxUsesPerRun: 4,
			maxContextMessages: 22,
			guidance: { promptSnippet: "Consult selectively.", promptGuidelines: ["Use judgment."] },
			futureField: { nested: ["preserve", 1] },
		};

		assert.equal(saveJsonConfig(path, fixture), true);
		assert.deepEqual(loadJsonConfig(path), fixture);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), fixture);
		assert.ok(Object.hasOwn(loadJsonConfig(path).byExecutor, "openai:gpt-5"));
	}));

test("save failure is observable and cleans up the same-directory temporary file", () =>
	withTempDir((directory) => {
		const directoryAsFile = join(directory, "not-a-file");
		mkdirSync(directoryAsFile);
		assert.equal(saveJsonConfig(directoryAsFile, { default: { modelStub: "a:b" } }), false);
		assert.deepEqual(readdirSync(directory), ["not-a-file"]);
	}));

test("updates one mapping while preserving unrelated and unknown config fields", () => {
	const existing = {
		default: { modelStub: "anthropic:old", effort: "low" },
		byExecutor: { "openai:existing": { modelStub: "anthropic:existing" } },
		guidance: { promptSnippet: "Keep me" },
		nudge: { mutationBurst: 7 },
		quietPaths: ["~/notes"],
		maxUsesPerRun: 3,
		maxContextMessages: 12,
		futureField: { enabled: true },
	};

	const updated = updateAdvisorConfig(existing, "anthropic:new", "high", "openai:gpt-5", { disabled: true });
	assert.deepEqual(updated, {
		...existing,
		byExecutor: {
			...existing.byExecutor,
			"openai:gpt-5": { modelStub: "anthropic:new", effort: "high", nudge: { disabled: true } },
		},
	});
});

test("updates preserve unknown fields within the selected entry", () => {
	const existing = {
		byExecutor: {
			"openai:gpt-5": { modelStub: "anthropic:old", effort: "low", futureEntryField: { keep: true } },
		},
	};
	assert.deepEqual(updateAdvisorConfig(existing, "anthropic:new", undefined, "openai:gpt-5"), {
		default: { modelStub: "anthropic:new" },
		byExecutor: {
			"openai:gpt-5": { modelStub: "anthropic:new", futureEntryField: { keep: true } },
		},
	});
});

test("first per-executor selection seeds default and clearing removes only that mapping", () => {
	const seeded = updateAdvisorConfig({}, "anthropic:advisor", "high", "openai:executor");
	assert.deepEqual(seeded, {
		default: { modelStub: "anthropic:advisor", effort: "high" },
		byExecutor: { "openai:executor": { modelStub: "anthropic:advisor", effort: "high" } },
	});
	assert.deepEqual(updateAdvisorConfig(seeded, undefined, undefined, "openai:executor"), {
		default: { modelStub: "anthropic:advisor", effort: "high" },
	});
});

test("resolves per-executor mapping before default", () => {
	const config = {
		default: { modelStub: "anthropic:default" },
		byExecutor: { "openai:gpt-5": { modelStub: "anthropic:specific" } },
	};
	assert.equal(resolveAdvisorEntry(config, "openai:gpt-5")?.modelStub, "anthropic:specific");
	assert.equal(resolveAdvisorEntry(config, "openai:other")?.modelStub, "anthropic:default");
	assert.equal(resolveAdvisorEntry({}, "openai:gpt-5"), undefined);
});

test("model stub codec accepts and emits colon keys only", () => {
	assert.deepEqual(parseModelStub("anthropic:claude:version"), {
		provider: "anthropic",
		modelId: "claude:version",
	});
	assert.equal(parseModelStub("anthropic/claude"), undefined);
	assert.equal(parseModelStub(":claude"), undefined);
	assert.equal(parseModelStub("anthropic:"), undefined);
	assert.equal(modelStubOf({ provider: "anthropic", id: "claude" }), "anthropic:claude");
	assert.equal(modelStubOf(undefined), undefined);
});

test("advisor effort validation accepts current levels and rejects unknown values", () => {
	assert.equal(validateAdvisorEffort("max", "test mapping"), "max");
	assert.equal(validateAdvisorEffort(undefined, "test mapping"), undefined);
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (message) => warnings.push(String(message));
	try {
		assert.equal(validateAdvisorEffort("ultra", "test mapping"), undefined);
		assert.equal(validateAdvisorEffort("max", "limited model", ["low", "medium", "high"]), undefined);
	} finally {
		console.warn = originalWarn;
	}
	assert.equal(warnings.length, 2);
	assert.match(warnings[0], /unsupported effort "ultra".*test mapping/i);
	assert.match(warnings[1], /unsupported effort "max".*limited model/i);
});

test("guidance validation keeps only complete supported fields", () => {
	assert.deepEqual(
		validateGuidanceFields({
			promptSnippet: "Consult selectively.",
			promptGuidelines: ["First", "Second"],
			unknown: true,
		}),
		{ promptSnippet: "Consult selectively.", promptGuidelines: ["First", "Second"] },
	);
	assert.deepEqual(validateGuidanceFields({ promptSnippet: "", promptGuidelines: ["valid", ""] }), {});
	assert.deepEqual(validateGuidanceFields([]), {});
});
