import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, afterEach } from "node:test";
import { ADVISOR_CONFIG_PATH, __setAdvisorConfigPathForTests } from "../extensions/advisor/advisor/config.ts";
import { registerAdvisorBeforeAgentStart, registerModelSelectHandler } from "../extensions/advisor/advisor/handlers.ts";
import { applyAdvisorForExecutor } from "../extensions/advisor/advisor/restore.ts";
import { getAdvisorEffort, getAdvisorModel, setActiveExecutorKey, setAdvisorEffort, setAdvisorModel } from "../extensions/advisor/advisor/state.ts";

const executorA = { provider: "openai", id: "gpt-5", name: "GPT 5" };
const executorB = { provider: "google", id: "gemini", name: "Gemini" };
const advisorA = { provider: "anthropic", id: "opus", name: "Opus" };
const advisorB = { provider: "anthropic", id: "sonnet", name: "Sonnet" };
const testDirectory = mkdtempSync(join(tmpdir(), "pi-advisor-lifecycle-"));
const testConfigPath = join(testDirectory, "pi-advisor.json");
const productionConfigExisted = existsSync(ADVISOR_CONFIG_PATH);
const productionConfigBefore = productionConfigExisted ? readFileSync(ADVISOR_CONFIG_PATH) : undefined;
const restoreConfigPath = __setAdvisorConfigPathForTests(testConfigPath);

function writeConfig(config) {
	mkdirSync(dirname(testConfigPath), { recursive: true });
	writeFileSync(testConfigPath, JSON.stringify(config), "utf8");
}
function harness(models = [advisorA, advisorB]) {
	let activeTools = ["other"];
	const events = new Map();
	const notifications = [];
	const pi = {
		getActiveTools: () => activeTools,
		setActiveTools: (tools) => { activeTools = tools; },
		on: (name, handler) => { events.set(name, handler); },
	};
	const ctx = {
		hasUI: true,
		ui: { notify: (message, level) => notifications.push([message, level]) },
		modelRegistry: { find: (provider, id) => models.find((model) => model.provider === provider && model.id === id) },
	};
	return { pi, ctx, events, notifications, activeTools: () => activeTools };
}

afterEach(() => {
	rmSync(testConfigPath, { force: true });
	setAdvisorModel(undefined); setAdvisorEffort(undefined); setActiveExecutorKey(undefined);
});

after(() => {
	restoreConfigPath();
	rmSync(testDirectory, { recursive: true, force: true });
	assert.equal(existsSync(ADVISOR_CONFIG_PATH), productionConfigExisted);
	if (productionConfigBefore) assert.deepEqual(readFileSync(ADVISOR_CONFIG_PATH), productionConfigBefore);
});

test("restore resolves a specific executor before default and activates the tool", () => {
	writeConfig({ default: { modelStub: "anthropic:sonnet", effort: "low" }, byExecutor: { "openai:gpt-5": { modelStub: "anthropic:opus", effort: "high" } } });
	const h = harness();
	applyAdvisorForExecutor(executorA, h.ctx, h.pi, "restore");
	assert.equal(getAdvisorModel(), advisorA);
	assert.equal(getAdvisorEffort(), "high");
	assert.deepEqual(h.activeTools(), ["other", "advisor"]);
	assert.equal(h.notifications.length, 1);
});

test("model switch reconciles model and effort immediately", async () => {
	writeConfig({ byExecutor: { "openai:gpt-5": { modelStub: "anthropic:opus", effort: "high" }, "google:gemini": { modelStub: "anthropic:sonnet", effort: "medium" } } });
	const h = harness();
	applyAdvisorForExecutor(executorA, h.ctx, h.pi, "restore");
	registerModelSelectHandler(h.pi);
	await h.events.get("model_select")({ model: executorB, source: "set" }, h.ctx);
	assert.equal(getAdvisorModel(), advisorB);
	assert.equal(getAdvisorEffort(), "medium");
	assert.match(h.notifications.at(-1)[0], /swapped.*anthropic:sonnet/i);
});

test("missing mapping clears stale state and strips tool", () => {
	writeConfig({ byExecutor: { "openai:gpt-5": { modelStub: "anthropic:opus" } } });
	const h = harness();
	applyAdvisorForExecutor(executorA, h.ctx, h.pi, "restore");
	writeConfig({});
	applyAdvisorForExecutor(executorB, h.ctx, h.pi, "swap");
	assert.equal(getAdvisorModel(), undefined);
	assert.equal(getAdvisorEffort(), undefined);
	assert.deepEqual(h.activeTools(), ["other"]);
});

test("malformed and unavailable mappings clear stale state", () => {
	for (const modelStub of ["not-a-colon-key", "anthropic:missing"]) {
		writeConfig({ default: { modelStub } });
		setAdvisorModel(advisorA); setAdvisorEffort("high");
		const h = harness(); h.pi.setActiveTools(["other", "advisor"]);
		applyAdvisorForExecutor(executorA, h.ctx, h.pi, "restore");
		assert.equal(getAdvisorModel(), undefined);
		assert.deepEqual(h.activeTools(), ["other"]);
	}
});

test("before_agent_start strips a tool whose model state was cleared", async () => {
	const h = harness(); h.pi.setActiveTools(["other", "advisor"]);
	registerAdvisorBeforeAgentStart(h.pi);
	await h.events.get("before_agent_start")({}, h.ctx);
	assert.deepEqual(h.activeTools(), ["other"]);
});

test("lifecycle never rewrites the persisted colon-keyed mapping", () => {
	const fixture = { byExecutor: { "openai:gpt-5": { modelStub: "anthropic:opus" } }, future: true };
	writeConfig(fixture);
	const h = harness(); applyAdvisorForExecutor(executorA, h.ctx, h.pi, "restore");
	assert.deepEqual(JSON.parse(readFileSync(testConfigPath, "utf8")), fixture);
});
