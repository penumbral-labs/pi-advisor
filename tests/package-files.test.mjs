import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const expectedPackageFiles = [
	"CHANGELOG.md",
	"LICENSE",
	"README.md",
	"docs/configuration.md",
	"docs/tool-reference.md",
	"extensions/advisor/adaptive-thinking.ts",
	"extensions/advisor/advisor-ui.ts",
	"extensions/advisor/advisor/command.ts",
	"extensions/advisor/advisor/config.ts",
	"extensions/advisor/advisor/context.ts",
	"extensions/advisor/advisor/curation.ts",
	"extensions/advisor/advisor/execute.ts",
	"extensions/advisor/advisor/execution-context.ts",
	"extensions/advisor/advisor/handlers.ts",
	"extensions/advisor/advisor/index.ts",
	"extensions/advisor/advisor/inventory.ts",
	"extensions/advisor/advisor/messages-curation.ts",
	"extensions/advisor/advisor/messages.ts",
	"extensions/advisor/advisor/nudges.ts",
	"extensions/advisor/advisor/pi-compat.ts",
	"extensions/advisor/advisor/prompt.ts",
	"extensions/advisor/advisor/register.ts",
	"extensions/advisor/advisor/restore.ts",
	"extensions/advisor/advisor/state.ts",
	"extensions/advisor/fuzzy.ts",
	"extensions/advisor/guidance.ts",
	"extensions/advisor/index.ts",
	"extensions/advisor/prompts/advisor-system.txt",
	"package.json",
];

test("npm package ships every runtime source, prompt, and user document", () => {
	const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
		cwd: new URL("..", import.meta.url),
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	const pack = JSON.parse(result.stdout)[0];
	assert.equal(pack.version, "0.2.0");
	assert.deepEqual(pack.files.map((file) => file.path).sort(), expectedPackageFiles);
});
