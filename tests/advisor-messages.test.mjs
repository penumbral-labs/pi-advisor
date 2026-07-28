/**
 * Unit tests for buildAdvisorMessages and shouldNudge.
 * Ported from RimuruW/pi-advisor (MIT License, Copyright (c) 2026 RimuruW).
 * Source: https://github.com/RimuruW/pi-advisor/blob/main/tests/package.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildAdvisorMessages } from "../extensions/advisor/advisor/messages-curation.ts";
import { cwdMatchesQuietPath, shouldNudge } from "../extensions/advisor/advisor/nudges.ts";

// ---------------------------------------------------------------------------
// buildAdvisorMessages
// ---------------------------------------------------------------------------

test("strips historical toolCall blocks from assistant messages", () => {
	const stageInfo = { stage: "initial", reason: "test" };
	const branch = [
		{ type: "message", message: { role: "user", content: "Investigate this issue", timestamp: 1 } },
		{
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "I will inspect the file." },
					{ type: "toolCall", id: "call_abc123", name: "read", arguments: { path: "src/foo.ts" } },
				],
				timestamp: 2,
			},
		},
	];

	const messages = buildAdvisorMessages(branch, stageInfo, "- read src/foo.ts", 10);
	assert.equal(messages.length, 4);

	const assistant = messages[2];
	assert.equal(assistant.role, "assistant");
	assert.deepEqual(assistant.content, [{ type: "text", text: "I will inspect the file." }]);
	assert.doesNotMatch(JSON.stringify(messages), /call_abc123/);
	assert.doesNotMatch(JSON.stringify(messages), /"toolCall"/);

	const closure = messages[3];
	assert.equal(closure.role, "user");
	assert.match(String(closure.content), /Provide your advisory assessment/);
});

test("closure: ends with assistant → closure message appended", () => {
	const stageInfo = { stage: "initial", reason: "test" };
	const branch = [
		{ type: "message", message: { role: "user", content: "Investigate this issue", timestamp: 1 } },
		{
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "I will inspect the file." }], timestamp: 2 },
		},
	];

	const messages = buildAdvisorMessages(branch, stageInfo, "", 10);
	const last = messages[messages.length - 1];
	assert.equal(last.role, "user");
	assert.match(String(last.content), /Provide your advisory assessment/);
});

test("closure: ends with user → unchanged", () => {
	const stageInfo = { stage: "initial", reason: "test" };
	const branch = [
		{ type: "message", message: { role: "user", content: "Investigate this issue", timestamp: 1 } },
		{
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "I will inspect the file." }], timestamp: 2 },
		},
		{ type: "message", message: { role: "user", content: "Next question here", timestamp: 3 } },
	];

	const messages = buildAdvisorMessages(branch, stageInfo, "", 10);
	const last = messages[messages.length - 1];
	assert.equal(last.role, "user");
	assert.equal(last.content, "Next question here");
});

test("closure: truncated path ending with assistant → closure appended", () => {
	const stageInfo = { stage: "initial", reason: "test" };
	const branch = [];
	for (let i = 0; i < 30; i++) {
		branch.push({ type: "message", message: { role: "user", content: `Question ${i}`, timestamp: i * 2 } });
		branch.push({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: `Answer ${i}` }], timestamp: i * 2 + 1 },
		});
	}

	const messages = buildAdvisorMessages(branch, stageInfo, "", 6);
	assert.equal(messages.length, 6);
	const last = messages[messages.length - 1];
	assert.equal(last.role, "user");
	assert.match(String(last.content), /Provide your advisory assessment/);
});

test("empty transcript → empty result, no closure", () => {
	const messages = buildAdvisorMessages([], { stage: "initial", reason: "test" }, "", 10);
	assert.equal(messages.length, 0);
});

test("context message includes context policy block", () => {
	const branch = [
		{ type: "message", message: { role: "user", content: "Task", timestamp: 1 } },
	];

	const messages = buildAdvisorMessages(branch, { stage: "initial", reason: "test" }, "- read foo", 10);
	const contextMsg = messages[0];
	assert.equal(contextMsg.role, "user");
	assert.match(String(contextMsg.content), /Context policy/);
	assert.match(String(contextMsg.content), /Assistant tool calls are stripped/);
});

test("context message includes executor signals when provided", () => {
	const branch = [{ type: "message", message: { role: "user", content: "Task", timestamp: 1 } }];
	const signals = { phase: "exploring", mutationsCount: 0, verificationCommands: [], recentFailures: [] };

	const messages = buildAdvisorMessages(branch, { stage: "initial", reason: "test" }, "- read foo", 10, signals);
	const contextMsg = messages[0];
	assert.match(String(contextMsg.content), /Executor signals/);
	assert.match(String(contextMsg.content), /Phase: exploring/);
	assert.match(String(contextMsg.content), /Mutations: 0/);
});

test("context message omits executor signals block when signals not provided", () => {
	const branch = [{ type: "message", message: { role: "user", content: "Task", timestamp: 1 } }];

	const messages = buildAdvisorMessages(branch, { stage: "initial", reason: "test" }, "- read foo", 10);
	assert.doesNotMatch(String(messages[0].content), /Executor signals/);
});

test("signals block reflects mutations, verifications, and failures", () => {
	const branch = [{ type: "message", message: { role: "user", content: "Task", timestamp: 1 } }];
	const signals = {
		phase: "verifying",
		mutationsCount: 3,
		verificationCommands: ["pnpm test", "pnpm lint"],
		recentFailures: ["$ tsc (exit 2)"],
	};

	const messages = buildAdvisorMessages(branch, { stage: "recovery", reason: "test" }, "- edit src/foo.ts", 10, signals);
	const contextMsg = messages[0];
	assert.match(String(contextMsg.content), /Phase: verifying/);
	assert.match(String(contextMsg.content), /Mutations: 3/);
	assert.match(String(contextMsg.content), /pnpm test, pnpm lint/);
	assert.match(String(contextMsg.content), /\$ tsc \(exit 2\)/);
});

test("curates canonical messages while preserving compaction and branch summaries", () => {
	const canonical = [
		{ role: "user", content: [{ type: "text", text: "The conversation history before this point was compacted into the following summary:\n\n<summary>\nCOMPACTED SUMMARY\n</summary>" }], timestamp: 1 },
		{ role: "user", content: [{ type: "text", text: "The following is a summary of a branch that this conversation came back from:\n\n<summary>\nBRANCH SUMMARY\n</summary>" }], timestamp: 2 },
		{ role: "assistant", content: [{ type: "text", text: "working" }, { type: "toolCall", name: "read", arguments: {} }], timestamp: 3 },
		{ role: "toolResult", content: [{ type: "text", text: "NOISY TOOL PAYLOAD" }], timestamp: 4 },
		{ role: "user", content: [{ type: "text", text: "latest task" }], timestamp: 5 },
	];

	const messages = buildAdvisorMessages(canonical, { stage: "initial", reason: "test" }, "", 8);
	const serialized = JSON.stringify(messages);
	assert.match(serialized, /COMPACTED SUMMARY/);
	assert.match(serialized, /BRANCH SUMMARY/);
	assert.doesNotMatch(serialized, /NOISY TOOL PAYLOAD/);
	assert.doesNotMatch(serialized, /toolCall/);
});

test("maxMessages is a hard limit with no duplicated transcript messages", () => {
	const branch = Array.from({ length: 8 }, (_, index) => ({
		role: "user",
		content: `unique message ${index}`,
		timestamp: index,
	}));
	const messages = buildAdvisorMessages(branch, { stage: "initial", reason: "test" }, "", 4);
	assert.equal(messages.length, 4);
	const serialized = JSON.stringify(messages);
	for (let index = 0; index < branch.length; index++) {
		const matches = serialized.match(new RegExp(`unique message ${index}`, "g")) ?? [];
		assert.ok(matches.length <= 1, `message ${index} must not be duplicated`);
	}
});

test("canonical summaries survive when they fall outside the bounded first and last windows", () => {
	const canonical = Array.from({ length: 12 }, (_, index) => ({
		role: "user",
		content: [{ type: "text", text: `message ${index}` }],
		timestamp: index,
	}));
	canonical[5] = {
		role: "user",
		content: [{ type: "text", text: "The following is a summary of a branch that this conversation came back from:\n\n<summary>\nMIDDLE BRANCH SUMMARY\n</summary>" }],
		timestamp: 5,
	};

	const messages = buildAdvisorMessages(canonical, { stage: "initial", reason: "test" }, "", 6);
	assert.equal(messages.length, 6);
	assert.match(JSON.stringify(messages), /MIDDLE BRANCH SUMMARY/);
	assert.match(JSON.stringify(messages), /earlier transcript messages omitted/);
});

test("stage inference and explicit overrides describe the executor state", async () => {
	const { buildExecutorContext, detectAdvisorStage } = await import("../extensions/advisor/advisor/execution-context.ts");
	const events = [
		{ toolName: "read", summary: "read a", isError: false, timestamp: 1 },
		{ toolName: "edit", summary: "edit a", isError: false, timestamp: 2 },
		{ toolName: "bash", summary: "$ npm test", command: "npm test", isError: false, timestamp: 3 },
	];
	assert.equal(detectAdvisorStage(events, 1).stage, "final-check");
	const failedVerification = [
		{ toolName: "edit", summary: "edit a", isError: false, timestamp: 1 },
		{ toolName: "bash", summary: "$ npm test (exit 1)", command: "npm test", isError: true, timestamp: 2 },
	];
	assert.equal(detectAdvisorStage(failedVerification, 1).stage, "recovery");
	assert.equal(buildExecutorContext(failedVerification, 1).signals.phase, "stuck");
	assert.equal(detectAdvisorStage([{ toolName: "bash", summary: "$ test", isError: true, timestamp: 1 }], 1).stage, "recovery");
	assert.equal(detectAdvisorStage([{ toolName: "read", summary: "read a", isError: false, timestamp: 1 }], 1).stage, "initial");
	assert.equal(buildExecutorContext(events, 1, "recovery").stageInfo.stage, "recovery");
	assert.match(buildExecutorContext(events, 1, "recovery").stageInfo.reason, /explicitly signaled/);
});

test("latest successful verification recovers from earlier failures", async () => {
	const { buildExecutorContext } = await import("../extensions/advisor/advisor/execution-context.ts");
	for (const events of [
		[
			{ toolName: "bash", summary: "$ transient command (exit 1)", command: "printf transient", isError: true, timestamp: 1 },
			{ toolName: "edit", summary: "edit a", isError: false, timestamp: 2 },
			{ toolName: "bash", summary: "$ npm test", command: "npm test", isError: false, timestamp: 3 },
		],
		[
			{ toolName: "edit", summary: "edit a", isError: false, timestamp: 1 },
			{ toolName: "bash", summary: "$ npm test (exit 1)", command: "npm test", isError: true, timestamp: 2 },
			{ toolName: "bash", summary: "$ npm test", command: "npm test", isError: false, timestamp: 3 },
		],
	]) {
		const context = buildExecutorContext(events, 1);
		assert.equal(context.stageInfo.stage, "final-check");
		assert.equal(context.signals.phase, "verifying");
	}
});

// ---------------------------------------------------------------------------
// shouldNudge
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// shouldNudge — guard conditions
// ---------------------------------------------------------------------------

test("shouldNudge: advisor not enabled → null", () => {
	const events = [{ toolName: "read" }, { toolName: "read" }, { toolName: "read" }, { toolName: "edit" }];
	assert.equal(shouldNudge(events, 0, false, 5), null);
});

test("shouldNudge: cfg.disabled → null", () => {
	const events = [{ toolName: "read" }, { toolName: "read" }, { toolName: "read" }, { toolName: "edit" }];
	assert.equal(shouldNudge(events, 0, true, 5, { disabled: true }), null);
});

test("shouldNudge: max uses reached → null", () => {
	const events = [{ toolName: "edit" }, { toolName: "edit" }, { toolName: "edit" }, { toolName: "edit" }];
	assert.equal(shouldNudge(events, 5, true, 5), null);
});

test("shouldNudge: advisor already consulted this run → null", () => {
	const events = [{ toolName: "read" }, { toolName: "read" }, { toolName: "read" }, { toolName: "edit" }];
	assert.equal(shouldNudge(events, 1, true, 5), null);
});

// ---------------------------------------------------------------------------
// shouldNudge — trigger 1: pre-execution
// ---------------------------------------------------------------------------

test("shouldNudge: pre-execution — first write after enough exploration → hint", () => {
	const events = [
		{ toolName: "read" }, { toolName: "bash" }, { toolName: "read" },
		{ toolName: "edit" },
	];
	const hint = shouldNudge(events, 0, true, 5);
	assert.ok(hint !== null, "expected a hint");
	assert.match(hint, /If independent judgment could materially change the approach/);
	assert.match(hint, /advisor\(\{stage: 'initial'\}\)/);
});

test("shouldNudge: pre-execution — first write but insufficient exploration → null", () => {
	const events = [{ toolName: "read" }, { toolName: "read" }, { toolName: "edit" }];
	// Only 2 exploration calls before the write; default threshold is 3
	assert.equal(shouldNudge(events, 0, true, 5), null);
});

test("shouldNudge: pre-execution — respects custom threshold", () => {
	const events = [{ toolName: "read" }, { toolName: "edit" }];
	// 1 exploration call; threshold lowered to 1 via config
	const hint = shouldNudge(events, 0, true, 5, { preExecutionMinExploration: 1 });
	assert.ok(hint !== null);
	assert.match(hint, /advisor/);
});

test("shouldNudge: pre-execution — second mutation does not re-fire", () => {
	// 3 reads then 2 writes; trigger fires only on mutationCount === 1
	const events = [
		{ toolName: "read" }, { toolName: "read" }, { toolName: "read" },
		{ toolName: "edit" }, { toolName: "edit" },
	];
	// mutationCount is 2 here, so pre-execution trigger doesn't apply
	// and mutation burst threshold (default 4) not reached yet → null
	assert.equal(shouldNudge(events, 0, true, 5), null);
});

// ---------------------------------------------------------------------------
// shouldNudge — trigger 2: mutation burst
// ---------------------------------------------------------------------------

test("shouldNudge: mutation burst — fires exactly at threshold", () => {
	const events = [
		{ toolName: "edit" }, { toolName: "edit" }, { toolName: "edit" }, { toolName: "edit" },
	];
	const hint = shouldNudge(events, 0, true, 5);
	assert.ok(hint !== null);
	assert.match(hint, /4 code changes/);
	assert.match(hint, /consider `advisor\(\)`/);
});

test("shouldNudge: mutation burst — below threshold → null", () => {
	const events = [{ toolName: "edit" }, { toolName: "edit" }, { toolName: "edit" }];
	assert.equal(shouldNudge(events, 0, true, 5), null);
});

test("shouldNudge: mutation burst — above threshold does not re-fire", () => {
	// 5 mutations; burst fires at exactly 4, not at 5
	const events = [
		{ toolName: "edit" }, { toolName: "edit" }, { toolName: "edit" },
		{ toolName: "edit" }, { toolName: "edit" },
	];
	assert.equal(shouldNudge(events, 0, true, 5), null);
});

test("shouldNudge: mutation burst — respects custom threshold", () => {
	const events = [{ toolName: "edit" }, { toolName: "edit" }];
	const hint = shouldNudge(events, 0, true, 5, { mutationBurst: 2 });
	assert.ok(hint !== null);
	assert.match(hint, /2 code changes/);
});

// ---------------------------------------------------------------------------
// shouldNudge — trigger 3: long run
// ---------------------------------------------------------------------------

test("shouldNudge: long run — fires exactly at threshold", () => {
	const events = Array.from({ length: 15 }, () => ({ toolName: "read" }));
	const hint = shouldNudge(events, 0, true, 5);
	assert.ok(hint !== null);
	assert.match(hint, /15 tool calls/);
	assert.match(hint, /consider `advisor\(\)`/);
});

test("shouldNudge: long run — below threshold → null", () => {
	const events = Array.from({ length: 14 }, () => ({ toolName: "read" }));
	assert.equal(shouldNudge(events, 0, true, 5), null);
});

test("shouldNudge: long run — above threshold does not re-fire", () => {
	const events = Array.from({ length: 16 }, () => ({ toolName: "read" }));
	assert.equal(shouldNudge(events, 0, true, 5), null);
});

test("shouldNudge: long run — respects custom threshold", () => {
	const events = Array.from({ length: 8 }, () => ({ toolName: "bash" }));
	const hint = shouldNudge(events, 0, true, 5, { longRunToolCalls: 8 });
	assert.ok(hint !== null);
	assert.match(hint, /8 tool calls/);
});

// ---------------------------------------------------------------------------
// shouldNudge — preExecution toggle (light preset drops trigger 1)
// ---------------------------------------------------------------------------

test("shouldNudge: preExecution:false — first write after exploration does NOT fire trigger 1", () => {
	const events = [
		{ toolName: "read" }, { toolName: "bash" }, { toolName: "read" }, { toolName: "read" }, { toolName: "read" }, { toolName: "read" },
		{ toolName: "edit" },
	];
	// Default config would fire here (6 explorations ≥ 3); preExecution:false suppresses it.
	assert.equal(shouldNudge(events, 0, true, 5, { preExecution: false }), null);
});

test("shouldNudge: preExecution:false — burst/long-run nets still fire", () => {
	const events = [
		{ toolName: "edit" }, { toolName: "edit" }, { toolName: "edit" }, { toolName: "edit" },
	];
	const hint = shouldNudge(events, 0, true, 5, { preExecution: false });
	assert.ok(hint !== null, "mutation burst should still fire with preExecution off");
	assert.match(hint, /4 code changes/);
});

// ---------------------------------------------------------------------------
// cwdMatchesQuietPath
// ---------------------------------------------------------------------------

const HOME = "/Users/aaron.small";

test("cwdMatchesQuietPath: cwd under a ~/glob quiet path matches", () => {
	assert.equal(cwdMatchesQuietPath("/Users/aaron.small/work-os/wiki", ["~/work-os/**"], HOME), true);
});

test("cwdMatchesQuietPath: exact directory match (no trailing glob)", () => {
	assert.equal(cwdMatchesQuietPath("/Users/aaron.small/work-os", ["~/work-os"], HOME), true);
});

test("cwdMatchesQuietPath: trailing slash on cwd or pattern is ignored", () => {
	assert.equal(cwdMatchesQuietPath("/Users/aaron.small/work-os/wiki/", ["~/work-os/"], HOME), true);
});

test("cwdMatchesQuietPath: sibling prefix does NOT match (segment-aware)", () => {
	assert.equal(cwdMatchesQuietPath("/Users/aaron.small/work-os-2/repo", ["~/work-os/**"], HOME), false);
});

test("cwdMatchesQuietPath: unrelated cwd does not match", () => {
	assert.equal(cwdMatchesQuietPath("/Users/aaron.small/src/janus", ["~/work-os/**"], HOME), false);
});

test("cwdMatchesQuietPath: empty/undefined quietPaths → false", () => {
	assert.equal(cwdMatchesQuietPath("/Users/aaron.small/work-os", undefined, HOME), false);
	assert.equal(cwdMatchesQuietPath("/Users/aaron.small/work-os", [], HOME), false);
});
