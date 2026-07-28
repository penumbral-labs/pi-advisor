import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const extensionPath = fileURLToPath(new URL("../extensions/advisor/index.ts", import.meta.url));

function writeSmokeExtension(path) {
	writeFileSync(path, `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

function response(model, text) {
	const message = {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({ type: "start", partial: message });
		stream.push({ type: "text_start", contentIndex: 0, partial: message });
		stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
		stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
		stream.push({ type: "done", reason: "stop", message });
		stream.end();
	});
	return stream;
}

export default function smoke(pi) {
	pi.registerProvider("advisor-smoke", {
		name: "Advisor smoke",
		baseUrl: "http://127.0.0.1/unused",
		apiKey: "deterministic-smoke-value",
		api: "advisor-smoke-api",
		models: [
			{ id: "executor", name: "Smoke executor", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
			{ id: "reviewer", name: "Smoke reviewer", reasoning: true, input: ["text"], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
		],
		streamSimple(model, context) {
			if (model.id === "reviewer") {
				const serialized = JSON.stringify(context.messages);
				const mapped = serialized.includes("Current advisory stage:") && serialized.includes("SMOKE_TASK");
				return response(model, mapped ? "SMOKE_ADVISOR_OK" : "SMOKE_ADVISOR_BAD_CONTEXT");
			}
			const hasAdvisor = context.tools?.some((tool) => tool.name === "advisor");
			const tool = context.tools?.find((candidate) => candidate.name === "advisor");
			const message = context.messages.at(-1);
			const isToolResult = message?.role === "toolResult" && message?.toolName === "advisor";
			if (isToolResult) return response(model, String(message.content?.[0]?.text ?? "SMOKE_MISSING_RESULT"));
			if (!hasAdvisor || !tool) return response(model, "SMOKE_ADVISOR_NOT_ACTIVE");
			const call = {
				role: "assistant",
				content: [{ type: "toolCall", id: "smoke-advisor-call", name: "advisor", arguments: { stage: "initial" } }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "toolUse",
				timestamp: Date.now(),
			};
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: call });
				stream.push({ type: "toolcall_start", contentIndex: 0, partial: call });
				stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call.content[0], partial: call });
				stream.push({ type: "done", reason: "toolUse", message: call });
				stream.end();
			});
			return stream;
		},
	});
}
`, "utf8");
}

function runPiSmoke(agentDir, smokeExtension) {
	return new Promise((resolve, reject) => {
		const child = spawn("pi", [
			"--mode", "rpc",
			"--no-session",
			"--no-extensions",
			"--no-context-files",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--offline",
			"--extension", smokeExtension,
			"--extension", extensionPath,
			"--provider", "advisor-smoke",
			"--model", "executor",
		], {
			cwd: new URL("..", import.meta.url),
			env: { ...process.env, HOME: agentDir, PI_CODING_AGENT_DIR: join(agentDir, "pi-agent"), PI_OFFLINE: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const records = [];
		let promptSent = false;
		let commands;
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`Pi loader smoke timed out. stdout=${stdout}\nstderr=${stderr}`));
		}, 30_000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			for (;;) {
				const newline = stdout.indexOf("\n");
				if (newline < 0) break;
				const line = stdout.slice(0, newline);
				stdout = stdout.slice(newline + 1);
				if (!line.trim()) continue;
				const record = JSON.parse(line);
				records.push(record);
				if (record.type === "response" && record.id === "commands") {
					commands = record.data.commands;
					promptSent = true;
					child.stdin.write(`${JSON.stringify({ id: "prompt", type: "prompt", message: "SMOKE_TASK" })}\n`);
				}
				if (record.type === "agent_end" && promptSent) child.stdin.end();
			}
		});
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) return reject(new Error(`Pi loader smoke exited ${code}. stdout=${stdout}\nstderr=${stderr}`));
			resolve({ commands, output: `${records.map((record) => JSON.stringify(record)).join("\n")}\n${stdout}\n${stderr}` });
		});
		child.stdin.write(`${JSON.stringify({ id: "commands", type: "get_commands" })}\n`);
	});
}

test("Pi loads the extension, resolves a colon mapping, and executes advisor completion", { timeout: 40_000 }, async () => {
	const temp = mkdtempSync(join(tmpdir(), "pi-advisor-loader-smoke-"));
	try {
		const smokeExtension = join(temp, "smoke-provider.ts");
		writeSmokeExtension(smokeExtension);
		const configDirectory = join(temp, ".pi", "agent");
		mkdirSync(configDirectory, { recursive: true });
		writeFileSync(join(configDirectory, "pi-advisor.json"), JSON.stringify({
			byExecutor: {
				"advisor-smoke:executor": { modelStub: "advisor-smoke:reviewer", effort: "high" },
			},
		}, null, 2));
		const result = await runPiSmoke(temp, smokeExtension);
		assert.ok(result.commands.some((command) => command.name === "advisor" && command.source === "extension"));
		assert.match(result.output, /SMOKE_ADVISOR_OK/);
		assert.doesNotMatch(result.output, /SMOKE_ADVISOR_NOT_ACTIVE|SMOKE_ADVISOR_BAD_CONTEXT|compatibility import/i);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
