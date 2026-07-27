import assert from "node:assert/strict";
import test from "node:test";
import { ensureUserTailForAdvisor, stripInflightAdvisorCall } from "../extensions/advisor/advisor/context.ts";

const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const assistant = (content) => ({ role: "assistant", content, api: "x", provider: "x", model: "x", usage: {}, stopReason: "toolUse", timestamp: 2 });

test("stripInflightAdvisorCall removes only the tail advisor call", () => {
	const messages = [user("task"), assistant([{ type: "text", text: "thinking" }, { type: "toolCall", id: "one", name: "read", arguments: {} }, { type: "toolCall", id: "two", name: "advisor", arguments: {} }])];
	const result = stripInflightAdvisorCall(messages);
	assert.deepEqual(result.at(-1).content.map((part) => part.type === "toolCall" ? part.name : part.text), ["thinking", "read"]);
});

test("ensureUserTailForAdvisor appends a user nudge only after assistant", () => {
	const messages = [user("task"), assistant([{ type: "text", text: "thinking" }])];
	const result = ensureUserTailForAdvisor(messages);
	assert.equal(result.length, 3);
	assert.equal(result.at(-1).role, "user");
	assert.equal(ensureUserTailForAdvisor([user("task")]).length, 1);
});
