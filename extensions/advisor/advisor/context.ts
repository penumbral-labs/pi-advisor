/** Tail normalization for advisor requests. */

import type { Message } from "@earendil-works/pi-ai";
import { ADVISOR_TOOL_NAME, MSG_ADVISOR_NUDGE } from "./messages.js";

export function stripInflightAdvisorCall(messages: Message[]): Message[] {
	if (messages.length === 0) return messages;
	const last = messages[messages.length - 1];
	if (last.role !== "assistant") return messages;
	const filtered = last.content.filter((part) => !(part.type === "toolCall" && part.name === ADVISOR_TOOL_NAME));
	if (filtered.length === last.content.length) return messages;
	if (filtered.length === 0) return messages.slice(0, -1);
	return [...messages.slice(0, -1), { ...last, content: filtered }];
}

export function ensureUserTailForAdvisor(messages: Message[]): Message[] {
	if (messages.length === 0 || messages[messages.length - 1].role !== "assistant") return messages;
	return [...messages, {
		role: "user",
		content: [{ type: "text", text: MSG_ADVISOR_NUDGE }],
		timestamp: Date.now(),
	}];
}
