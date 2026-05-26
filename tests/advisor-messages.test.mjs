/**
 * Unit tests for buildAdvisorMessages and shouldNudge.
 * Ported from RimuruW/pi-advisor (MIT License, Copyright (c) 2026 RimuruW).
 * Source: https://github.com/RimuruW/pi-advisor/blob/main/tests/package.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildAdvisorMessages, shouldNudge } from "../extensions/advisor/advisor-messages.ts";

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

// ---------------------------------------------------------------------------
// shouldNudge
// ---------------------------------------------------------------------------

test("shouldNudge: no mutations → null", () => {
	const events = [{ toolName: "read", command: undefined }];
	assert.equal(shouldNudge(events, 0, true, 3), null);
});

test("shouldNudge: mutations with no verification → hint addressed to the agent", () => {
	const events = [{ toolName: "read" }, { toolName: "edit" }];
	const hint = shouldNudge(events, 0, true, 3);
	assert.match(hint, /no test\/build\/lint command has run yet/);
	// Speaks to whoever ends up reading it (agent or human) without pretending
	// the prior "Consider advisor(...)" tool-call syntax was an instruction.
	assert.match(hint, /advisor\(\{stage: 'final-check'\}\)/);
});

test("shouldNudge: mutations with verification → null", () => {
	const events = [{ toolName: "edit" }, { toolName: "bash", command: "npm test" }];
	assert.equal(shouldNudge(events, 0, true, 3), null);
});

test("shouldNudge: advisor disabled → null", () => {
	const events = [{ toolName: "edit" }];
	assert.equal(shouldNudge(events, 0, false, 3), null);
});

test("shouldNudge: max uses reached → null", () => {
	const events = [{ toolName: "edit" }];
	assert.equal(shouldNudge(events, 3, true, 3), null);
});
