import assert from "node:assert/strict";
import test from "node:test";

import advisorExtension from "../extensions/advisor/index.ts";

function extensionApiStub() {
	const registrations = { commands: [], events: [], tools: [] };
	const api = {
		getActiveTools: () => [],
		getAllTools: () => [],
		on: (name) => { registrations.events.push(name); },
		registerCommand: (name) => { registrations.commands.push(name); },
		registerTool: (tool) => { registrations.tools.push(tool.name); },
		setActiveTools: () => {},
	};
	return { api, registrations };
}

test("actual extension entrypoint links and registers against the Pi runtime contract", () => {
	const { api, registrations } = extensionApiStub();
	assert.doesNotThrow(() => advisorExtension(api));
	assert.deepEqual(registrations.tools, ["advisor"]);
	assert.deepEqual(registrations.commands, ["advisor"]);
	assert.deepEqual(registrations.events.sort(), [
		"agent_start",
		"before_agent_start",
		"model_select",
		"session_start",
		"session_start",
		"tool_execution_end",
		"tool_execution_start",
	]);
});
