import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, afterEach } from "node:test";

import { __setAdvisorConfigPathForTests, loadAdvisorConfig, saveAdvisorConfig } from "../extensions/advisor/advisor/config.ts";
import { registerAdvisorCommand } from "../extensions/advisor/advisor/command.ts";
import {
	DEFAULT_NUDGE_CONFIG,
	NUDGE_PRESETS,
	cwdMatchesQuietPath,
	registerAdvisorNudges,
	resetNudgeStateForTests,
	resolveNudgeConfig,
	shouldNudge,
	summarizeToolExecution,
} from "../extensions/advisor/advisor/nudges.ts";
import { getAdvisorModel, setActiveExecutorKey, setAdvisorModel } from "../extensions/advisor/advisor/state.ts";

const testDirectory = mkdtempSync(join(tmpdir(), "pi-advisor-nudges-"));
const testConfigPath = join(testDirectory, "pi-advisor.json");
const restoreConfigPath = __setAdvisorConfigPathForTests(testConfigPath);

function harness() {
	const events = new Map();
	const messages = [];
	const statuses = [];
	const pi = {
		on: (name, handler) => { events.set(name, handler); },
		sendMessage: (message, options) => { messages.push([message, options]); },
	};
	const ctx = { cwd: "/repo", ui: { setStatus: (key, value) => statuses.push([key, value]) } };
	return { pi, ctx, events, messages, statuses };
}

async function executeTool(h, toolName, id, args = {}, result = { content: [] }, isError = false) {
	await h.events.get("tool_execution_start")({ toolCallId: id, args }, h.ctx);
	await h.events.get("tool_execution_end")({ toolCallId: id, toolName, result, isError }, h.ctx);
}

afterEach(() => {
	rmSync(testConfigPath, { force: true });
	resetNudgeStateForTests();
	setAdvisorModel(undefined);
	setActiveExecutorKey(undefined);
});

after(() => {
	restoreConfigPath();
	rmSync(testDirectory, { recursive: true, force: true });
});

test("nudge config merges defaults, global settings, and resolved executor settings", () => {
	const config = {
		default: { modelStub: "anthropic:sonnet", nudge: { longRunToolCalls: 25 } },
		byExecutor: { "openai:gpt-5": { modelStub: "anthropic:opus", nudge: { mutationBurst: 2 } } },
		nudge: { preExecution: false, mutationBurst: 6 },
	};
	assert.deepEqual(resolveNudgeConfig(config, "openai:gpt-5"), {
		...DEFAULT_NUDGE_CONFIG,
		preExecution: false,
		mutationBurst: 2,
	});
	assert.equal(resolveNudgeConfig(config, "google:gemini").longRunToolCalls, 25);
});

test("preset contract exposes heavy, default, light, and off", () => {
	assert.deepEqual(Object.keys(NUDGE_PRESETS), ["heavy", "default", "light", "off"]);
	assert.equal(NUDGE_PRESETS.default, undefined);
	assert.equal(NUDGE_PRESETS.off.disabled, true);
});

test("event wiring sends one follow-up nudge and session backoff survives a new run", async () => {
	writeFileSync(testConfigPath, JSON.stringify({
		default: { modelStub: "anthropic:opus" },
		nudge: { preExecution: false, mutationBurst: 1, longRunToolCalls: 99, backoffToolCalls: 3 },
	}));
	setAdvisorModel({ provider: "anthropic", id: "opus", name: "Opus" });
	const h = harness();
	registerAdvisorNudges(h.pi);
	await h.events.get("session_start")({}, h.ctx);
	await h.events.get("agent_start")({}, h.ctx);
	await executeTool(h, "edit", "1", { path: "a.ts" });
	assert.equal(h.messages.length, 1);
	assert.equal(h.messages[0][1].deliverAs, "followUp");
	await executeTool(h, "edit", "duplicate", { path: "duplicate.ts" });
	assert.equal(h.messages.length, 1, "only one automatic nudge may be sent in a run");

	await h.events.get("agent_start")({}, h.ctx);
	await executeTool(h, "edit", "2", { path: "b.ts" });
	assert.equal(h.messages.length, 1, "backoff must survive follow-up micro-turns");
	await executeTool(h, "read", "3", { path: "b.ts" });
	await executeTool(h, "read", "4", { path: "b.ts" });
	await h.events.get("agent_start")({}, h.ctx);
	await executeTool(h, "edit", "5", { path: "c.ts" });
	assert.equal(h.messages.length, 2);
});

test("nudge config is cached across tool calls and refreshed after saveAdvisorConfig", async () => {
	writeFileSync(testConfigPath, JSON.stringify({
		default: { modelStub: "anthropic:opus" },
		nudge: { preExecution: false, mutationBurst: 99, longRunToolCalls: 99 },
	}));
	setAdvisorModel({ provider: "anthropic", id: "opus", name: "Opus" });
	const h = harness();
	registerAdvisorNudges(h.pi);
	await h.events.get("agent_start")({}, h.ctx);
	await executeTool(h, "edit", "1", { path: "a.ts" });
	writeFileSync(testConfigPath, JSON.stringify({
		default: { modelStub: "anthropic:opus" },
		nudge: { preExecution: false, mutationBurst: 2, longRunToolCalls: 99 },
	}));
	await executeTool(h, "edit", "2", { path: "b.ts" });
	assert.equal(h.messages.length, 0, "unchanged cache should avoid reloading config for every tool call");
	assert.equal(saveAdvisorConfig("anthropic:opus", undefined, undefined, { preExecution: false, mutationBurst: 3, longRunToolCalls: 99 }), true);
	await executeTool(h, "edit", "3", { path: "c.ts" });
	assert.equal(h.messages.length, 1, "successful config saves must invalidate the nudge cache");
});

test("inactive default mapping uses default-specific save and clear notifications", async () => {
	const models = [
		{ provider: "openai", id: "gpt-5", name: "GPT 5", reasoning: false },
		{ provider: "anthropic", id: "opus", name: "Opus", reasoning: false },
		{ provider: "anthropic", id: "sonnet", name: "Sonnet", reasoning: false },
	];
	for (const [choices, expected] of [
		[["__default__", "anthropic:sonnet", "heavy"], /Saved default advisor: anthropic:sonnet/],
		[["__default__", "__no_advisor__"], /Default advisor cleared/],
	]) {
		writeFileSync(testConfigPath, JSON.stringify({
			default: { modelStub: "anthropic:opus" },
			byExecutor: { "openai:gpt-5": { modelStub: "anthropic:opus" } },
		}));
		let command;
		const notifications = [];
		const pi = {
			getActiveTools: () => [],
			registerCommand: (_name, registration) => { command = registration; },
			setActiveTools: () => {},
		};
		registerAdvisorCommand(pi);
		const pendingChoices = [...choices];
		await command.handler("", {
			hasUI: true,
			model: models[0],
			modelRegistry: { getAvailable: () => models },
			ui: {
				custom: async () => pendingChoices.shift(),
				notify: (message) => notifications.push(message),
			},
		});
		assert.match(notifications.at(-1), expected);
		assert.doesNotMatch(notifications.at(-1), /undefined/);
	}
});

test("UI preset selection persists on the chosen executor mapping", async () => {
	writeFileSync(testConfigPath, "{}\n");
	const choices = ["openai:gpt-5", "anthropic:opus", "heavy"];
	let command;
	const pi = {
		getActiveTools: () => [],
		registerCommand: (_name, registration) => { command = registration; },
		setActiveTools: () => {},
	};
	registerAdvisorCommand(pi);
	const models = [
		{ provider: "openai", id: "gpt-5", name: "GPT 5", reasoning: false },
		{ provider: "anthropic", id: "opus", name: "Opus", reasoning: false },
	];
	const ctx = {
		hasUI: true,
		model: models[0],
		modelRegistry: { getAvailable: () => models },
		ui: { custom: async () => choices.shift(), notify: () => {} },
	};
	await command.handler("", ctx);
	assert.deepEqual(loadAdvisorConfig().byExecutor["openai:gpt-5"].nudge, NUDGE_PRESETS.heavy);
});

test("quiet paths silence automatic nudges without disabling the advisor model", async () => {
	writeFileSync(testConfigPath, JSON.stringify({
		default: { modelStub: "anthropic:opus" },
		nudge: { preExecution: false, mutationBurst: 1 },
		quietPaths: ["/quiet/**"],
	}));
	setAdvisorModel({ provider: "anthropic", id: "opus", name: "Opus" });
	const h = harness(); h.ctx.cwd = "/quiet/project";
	registerAdvisorNudges(h.pi);
	await h.events.get("agent_start")({}, h.ctx);
	await executeTool(h, "edit", "1", { path: "a.ts" });
	assert.equal(h.messages.length, 0);
	assert.equal(getAdvisorModel().id, "opus", "on-demand advisor state remains available");
});

test("tool execution summaries retain mutation paths and bash failures", () => {
	assert.match(summarizeToolExecution("edit", { path: "src/a.ts" }, { content: [] }, false).summary, /src\/a\.ts/);
	const bash = summarizeToolExecution("bash", { command: "npm test" }, { content: [{ type: "text", text: "exit code: 1" }] }, false);
	assert.equal(bash.isError, true);
	assert.match(bash.summary, /exit 1/);
});

test("threshold and quiet-path helpers remain segment-safe", () => {
	assert.ok(shouldNudge([{ toolName: "edit" }], 0, true, 5, { preExecution: false, mutationBurst: 1 }));
	assert.equal(cwdMatchesQuietPath("/home/a/work-os-2", ["~/work-os/**"], "/home/a"), false);
});
