import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const modules = ["command", "config", "context", "handlers", "index", "inventory", "messages", "pi-compat", "prompt", "register", "restore", "state"];

test("all modular lifecycle sources and fuzzy helper are shipped under extensions", () => {
	for (const module of modules) assert.equal(existsSync(new URL(`../extensions/advisor/advisor/${module}.ts`, import.meta.url)), true, module);
	assert.equal(existsSync(new URL("../extensions/advisor/fuzzy.ts", import.meta.url)), true);
});

test("entrypoint wires modular lifecycle without thinking-level blocklist handling", () => {
	const source = readFileSync(new URL("../extensions/advisor/index.ts", import.meta.url), "utf8");
	assert.match(source, /registerAdvisorSessionStart/);
	assert.match(source, /registerModelSelectHandler/);
	assert.doesNotMatch(source, /thinking_level_select|disabledForModels/);
});

test("command and UI retain the per-executor mappings flow and local fuzzy seam", () => {
	const command = readFileSync(new URL("../extensions/advisor/advisor/command.ts", import.meta.url), "utf8");
	const ui = readFileSync(new URL("../extensions/advisor/advisor-ui.ts", import.meta.url), "utf8");
	assert.match(command, /showMappingsPicker/);
	assert.match(command, /saveAdvisorConfig/);
	assert.match(command, /MSG_CONFIG_SAVE_FAILED/);
	assert.match(ui, /filterItems/);
	assert.match(ui, /Advisor Mappings/);
});

test("temporary adapter has no static root completeSimple import and stays below monolith limit", () => {
	const source = readFileSync(new URL("../extensions/advisor/advisor.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /import\s*\{[^}]*completeSimple[^}]*\}\s*from\s*["']@earendil-works\/pi-ai["']/s);
	assert.ok(source.split("\n").length <= 400);
});
