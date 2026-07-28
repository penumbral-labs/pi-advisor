import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";

import { __setAdvisorConfigPathForTests } from "../extensions/advisor/advisor/config.ts";
import { executeAdvisor, getAdvisorUsesThisRun, resetAdvisorUsage } from "../extensions/advisor/advisor/execute.ts";
import { pushRunToolEvent } from "../extensions/advisor/advisor/execution-context.ts";
import { resetNudgeRunState } from "../extensions/advisor/advisor/nudges.ts";
import { setAdvisorEffort, setAdvisorModel } from "../extensions/advisor/advisor/state.ts";

const tempDirs = [];
let configPath;
let restoreConfigPath;

function response(text = "advice", stopReason = "stop", errorMessage) {
	return {
		role: "assistant",
		content: text === undefined ? [] : [{ type: "text", text }],
		stopReason,
		errorMessage,
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
		timestamp: Date.now(),
	};
}

function makeContext({ runtimeComplete, messages } = {}) {
	const runtime = runtimeComplete ? { completeSimple: runtimeComplete } : undefined;
	return {
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", headers: { "x-test": "yes" } }),
			...(runtime ? { runtime } : {}),
		},
		sessionManager: {
			getEntries: () => messages ?? [{ type: "message", message: { role: "user", content: [{ type: "text", text: "task" }], timestamp: 1 } }],
			getLeafId: () => "leaf",
		},
	};
}

const pi = { getAllTools: () => [] };

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "pi-advisor-execute-"));
	tempDirs.push(dir);
	configPath = join(dir, "pi-advisor.json");
	writeFileSync(configPath, "{}\n");
	restoreConfigPath = __setAdvisorConfigPathForTests(configPath);
	setAdvisorModel({ provider: "litellm", id: "claude-opus-4-8" });
	setAdvisorEffort("high");
	resetAdvisorUsage();
	resetNudgeRunState();
	delete globalThis.__piAdvisorCompatCompleteSimple;
	delete globalThis.__piCodingAgentBuildSessionContext;
});

afterEach(() => {
	restoreConfigPath?.();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	delete globalThis.__piAdvisorCompatCompleteSimple;
	delete globalThis.__piCodingAgentBuildSessionContext;
});

test("runtime completion uses canonical context and adaptive onPayload without explicit auth overrides", async () => {
	const rawMessage = { role: "user", content: [{ type: "text", text: "RAW PRE-COMPACTION DETAIL" }], timestamp: 1 };
	globalThis.__piCodingAgentBuildSessionContext = () => ({
		messages: [
			{ role: "compactionSummary", summary: "COMPACTED SUMMARY", tokensBefore: 100, timestamp: 2 },
			{ role: "branchSummary", summary: "BRANCH SUMMARY", fromId: "old-leaf", timestamp: 3 },
			{ role: "user", content: [{ type: "text", text: "current task" }], timestamp: 4 },
		],
		thinkingLevel: "off",
		model: null,
	});
	let receivedOptions;
	let receivedMessages;
	const runtimeComplete = async (_model, context, options) => {
		receivedOptions = options;
		receivedMessages = context.messages;
		const normalized = options.onPayload({ reasoning_effort: "high" }, { provider: "litellm", id: "claude-opus-4-8" });
		assert.deepEqual(normalized, { thinking: { type: "adaptive" }, output_config: { effort: "high" } });
		return response();
	};

	const result = await executeAdvisor(makeContext({ runtimeComplete, messages: [rawMessage] }), pi, undefined, undefined);

	assert.equal(result.content[0].text, "advice");
	assert.equal(receivedOptions.reasoning, "high");
	assert.equal("apiKey" in receivedOptions, false);
	assert.equal("headers" in receivedOptions, false);
	const serialized = JSON.stringify(receivedMessages);
	assert.match(serialized, /COMPACTED SUMMARY/);
	assert.match(serialized, /BRANCH SUMMARY/);
	assert.doesNotMatch(serialized, /RAW PRE-COMPACTION DETAIL/);
});

test("tool inventory precedes curated context while empty inventory remains omitted", async () => {
	const tool = { name: "read", description: "Read a file", parameters: { type: "object" } };
	for (const [tools, expectedCount] of [[[tool], 1], [[], 0]]) {
		let receivedMessages;
		const runtimeComplete = async (_model, context) => {
			receivedMessages = context.messages;
			return response();
		};
		await executeAdvisor(makeContext({ runtimeComplete }), { getAllTools: () => tools }, undefined, undefined);
		const inventoryIndexes = receivedMessages
			.map((message, index) => JSON.stringify(message).includes("Available Executor Tools") ? index : -1)
			.filter((index) => index >= 0);
		assert.equal(inventoryIndexes.length, expectedCount);
		if (expectedCount) {
			assert.equal(inventoryIndexes[0], 0);
			assert.match(JSON.stringify(receivedMessages[0]), /### read/);
			assert.match(JSON.stringify(receivedMessages[1]), /Context policy/);
		}
		resetAdvisorUsage();
	}
});

test("concurrent calls reserve the max-use slot before awaiting auth", async () => {
	writeFileSync(configPath, JSON.stringify({ maxUsesPerRun: 1 }));
	let releaseAuth;
	const authReady = new Promise((resolve) => { releaseAuth = resolve; });
	let authChecks = 0;
	let completionsStarted = 0;
	const ctx = makeContext({
		runtimeComplete: async () => {
			completionsStarted++;
			return response();
		},
	});
	ctx.modelRegistry.getApiKeyAndHeaders = async () => {
		authChecks++;
		await authReady;
		return { ok: true, apiKey: "test-key", headers: {} };
	};

	const first = executeAdvisor(ctx, pi, undefined, undefined);
	const second = executeAdvisor(ctx, pi, undefined, undefined);
	const secondResult = await second;
	assert.equal(secondResult.details.errorMessage, "max_uses_exceeded");
	assert.equal(authChecks, 1);
	assert.equal(completionsStarted, 0);

	releaseAuth();
	const firstResult = await first;
	assert.equal(firstResult.content[0].text, "advice");
	assert.equal(completionsStarted, 1);
	assert.equal(getAdvisorUsesThisRun(), 1);
});

test("compatibility completion receives auth and adaptive onPayload", async () => {
	let receivedOptions;
	globalThis.__piAdvisorCompatCompleteSimple = async (_model, _context, options) => {
		receivedOptions = options;
		const normalized = options.onPayload({ reasoning_effort: "minimal" }, { provider: "litellm", id: "claude-opus-4-8" });
		assert.deepEqual(normalized, { thinking: { type: "adaptive" }, output_config: { effort: "low" } });
		return response("compat advice");
	};

	const result = await executeAdvisor(makeContext(), pi, undefined, undefined);

	assert.equal(result.content[0].text, "compat advice");
	assert.equal(receivedOptions.apiKey, "test-key");
	assert.deepEqual(receivedOptions.headers, { "x-test": "yes" });
});

test("returns structured results for usage, model, auth, context, response, and thrown failures", async (t) => {
	await t.test("usage limit", async () => {
		writeFileSync(configPath, JSON.stringify({ maxUsesPerRun: 0 }));
		const ctx = makeContext({ runtimeComplete: async () => response() });
		const result = await executeAdvisor(ctx, pi, undefined, undefined);
		assert.equal(result.details.errorMessage, "max_uses_exceeded");
		writeFileSync(configPath, "{}\n");
	});

	await t.test("validation failures release their usage reservation", async () => {
		writeFileSync(configPath, JSON.stringify({ maxUsesPerRun: 1 }));
		resetAdvisorUsage();
		setAdvisorModel(undefined);
		let result = await executeAdvisor(makeContext(), pi, undefined, undefined);
		assert.equal(result.details.errorMessage, "no advisor model selected");
		assert.equal("advisorModel" in result.details, false);
		assert.equal(getAdvisorUsesThisRun(), 0);

		setAdvisorModel({ provider: "litellm", id: "claude-opus-4-8" });
		const authContext = makeContext();
		authContext.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false, error: "bad auth" });
		result = await executeAdvisor(authContext, pi, undefined, undefined);
		assert.equal(result.details.errorMessage, "bad auth");
		assert.equal(getAdvisorUsesThisRun(), 0);

		const missingKeyContext = makeContext();
		missingKeyContext.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true });
		result = await executeAdvisor(missingKeyContext, pi, undefined, undefined);
		assert.match(result.details.errorMessage, /no api key/i);
		assert.equal(getAdvisorUsesThisRun(), 0);

		globalThis.__piCodingAgentBuildSessionContext = () => ({ messages: [], thinkingLevel: "off", model: null });
		result = await executeAdvisor(makeContext(), pi, undefined, undefined);
		assert.equal(result.details.errorMessage, "no_context");
		assert.equal(getAdvisorUsesThisRun(), 0);
		delete globalThis.__piCodingAgentBuildSessionContext;

		pushRunToolEvent({ toolName: "edit", summary: "edit source.ts", isError: false, timestamp: 1 });
		let successfulContext;
		result = await executeAdvisor(makeContext({ runtimeComplete: async (_model, context) => {
			successfulContext = context;
			return response("after validation");
		} }), pi, undefined, undefined);
		assert.equal(result.content[0].text, "after validation");
		assert.equal(getAdvisorUsesThisRun(), 1);
		assert.match(JSON.stringify(successfulContext), /Implementation is in progress/);
		assert.doesNotMatch(JSON.stringify(successfulContext), /checking course again/);
	});

	await t.test("aborted", async () => {
		resetAdvisorUsage();
		const result = await executeAdvisor(makeContext({ runtimeComplete: async () => response(undefined, "aborted") }), pi, undefined, undefined);
		assert.equal(result.details.stopReason, "aborted");
		assert.equal(result.details.errorMessage, "aborted");
		assert.equal(getAdvisorUsesThisRun(), 1);
	});

	await t.test("error", async () => {
		resetAdvisorUsage();
		const result = await executeAdvisor(makeContext({ runtimeComplete: async () => response(undefined, "error", "502") }), pi, undefined, undefined);
		assert.equal(result.details.stopReason, "error");
		assert.equal(result.details.errorMessage, "502");
		assert.equal(getAdvisorUsesThisRun(), 1);
	});

	await t.test("empty", async () => {
		resetAdvisorUsage();
		const result = await executeAdvisor(makeContext({ runtimeComplete: async () => response("   ") }), pi, undefined, undefined);
		assert.equal(result.details.errorMessage, "empty response");
		assert.equal(getAdvisorUsesThisRun(), 1);
	});

	await t.test("thrown", async () => {
		resetAdvisorUsage();
		const result = await executeAdvisor(makeContext({ runtimeComplete: async () => { throw new Error("boom"); } }), pi, undefined, undefined);
		assert.equal(result.details.errorMessage, "boom");
		assert.equal(getAdvisorUsesThisRun(), 1);
	});
});
