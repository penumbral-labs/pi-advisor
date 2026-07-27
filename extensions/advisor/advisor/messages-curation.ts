/**
 * Transcript curation for advisor context.
 *
 * Ported from RimuruW/pi-advisor (MIT License, Copyright (c) 2026 RimuruW).
 * Source: https://github.com/RimuruW/pi-advisor/blob/main/src/advisor-messages.ts
 *
 * Strips tool results and toolCall blocks from the serialized conversation branch,
 * clamps long text, windows to first+last N messages, and builds the context message
 * that frames the advisory request with stage/signal metadata.
 */

import type { ExecutorSignals } from "./execution-context.js";

type MessageContent = string | Array<{ type?: string; text?: string; [key: string]: unknown }> | unknown;

type AdvisorMessage = {
	role: string;
	content: MessageContent;
	timestamp?: number;
	[key: string]: unknown;
};

type SessionEntryLike = {
	type?: string;
	message?: AdvisorMessage;
	role?: string;
	content?: MessageContent;
	[key: string]: unknown;
};

type AdvisorStageInfoLike = {
	stage: string;
	reason: string;
};

const MAX_TEXT_LINES = 24;
const MAX_TEXT_CHARS = 1800;

function clampText(text: string, maxLines: number = MAX_TEXT_LINES, maxChars: number = MAX_TEXT_CHARS): string {
	const normalized = text.trim();
	if (!normalized) return normalized;

	const lines = normalized.split("\n");
	let truncated = false;
	let next = lines.slice(0, maxLines).join("\n");
	if (lines.length > maxLines) truncated = true;
	if (next.length > maxChars) {
		next = `${next.slice(0, maxChars).trimEnd()}…`;
		truncated = true;
	}
	if (!truncated) return next;
	return `${next}\n[truncated for advisor context]`;
}

function summarizeUserContent(content: MessageContent): MessageContent {
	if (typeof content === "string") return clampText(content, 40, 2800);
	if (!Array.isArray(content)) return content;
	return content.map((block) => {
		if (block?.type !== "text" || typeof block.text !== "string") return block;
		return { ...block, text: clampText(block.text, 40, 2800) };
	});
}

export function summarizeAssistantContent(content: Array<{ type?: string; text?: string; [key: string]: unknown }>): Array<{ type: "text"; text: string }> {
	return content
		.filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
		.map((block) => ({ ...block, text: clampText(block.text) }));
}

function buildContextPolicy(): string {
	return `Context policy:
- Assistant tool calls are stripped from the transcript below.
- Tool results are not replayed.
- User task framing is retained where possible.
- If truncated: earliest messages omitted, focus on recent evidence.`;
}

function buildSignalsBlock(signals: ExecutorSignals): string {
	const vc = signals.verificationCommands.length > 0
		? signals.verificationCommands.join(", ")
		: "none";
	const rf = signals.recentFailures.length > 0
		? signals.recentFailures.join("; ")
		: "none";
	return `Executor signals:
- Phase: ${signals.phase}
- Mutations: ${signals.mutationsCount}
- Verification commands run: ${vc}
- Recent failures: ${rf}`;
}

function isCanonicalSummary(message: AdvisorMessage): boolean {
	if (message.role !== "user") return false;
	const text = typeof message.content === "string"
		? message.content
		: Array.isArray(message.content)
			? message.content.filter((block) => block?.type === "text").map((block) => block.text).join("\n")
			: "";
	return text.includes("The conversation history before this point was compacted into the following summary:") ||
		text.includes("The following is a summary of a branch that this conversation came back from:");
}

function ensureAdvisorRequestClosure(messages: AdvisorMessage[]): AdvisorMessage[] {
	if (messages.length === 0) return messages;
	const last = messages[messages.length - 1];
	if (last.role === "user") return messages;
	return [
		...messages,
		{
			role: "user",
			content: "Provide your advisory assessment now based on the context above.",
			timestamp: Date.now(),
		},
	];
}

export function buildAdvisorMessages(
	branch: SessionEntryLike[],
	stageInfo: AdvisorStageInfoLike,
	recentToolActivity: string,
	maxMessages: number,
	signals?: ExecutorSignals,
): AdvisorMessage[] {
	const transcript: AdvisorMessage[] = [];

	for (const entry of branch) {
		const msg = entry.type === "message" ? entry.message : entry as AdvisorMessage;
		if (!msg || typeof msg.role !== "string") continue;

		if (msg.role === "user") {
			transcript.push({ ...msg, content: summarizeUserContent(msg.content) });
			continue;
		}

		if (msg.role === "assistant") {
			const content = Array.isArray(msg.content) ? summarizeAssistantContent(msg.content) : [];
			if (content.length > 0) transcript.push({ ...msg, content });
			continue;
		}

		if (msg.role === "toolResult") {
			continue;
		}
	}

	if (transcript.length === 0) return [];

	const contextBlocks: string[] = [buildContextPolicy()];
	contextBlocks.push(`Current advisory stage: ${stageInfo.stage}`);
	contextBlocks.push(`Why this stage: ${stageInfo.reason}`);
	if (signals) contextBlocks.push(buildSignalsBlock(signals));
	contextBlocks.push(recentToolActivity ? `Recent tool activity:\n${recentToolActivity}` : "Recent tool activity: none yet");

	const contextMessage: AdvisorMessage = {
		role: "user",
		content: contextBlocks.join("\n\n"),
		timestamp: Date.now(),
	};

	if (transcript.length <= maxMessages) {
		return ensureAdvisorRequestClosure([contextMessage, ...transcript]);
	}

	const keepFirst = 2;
	const keepLast = Math.max(1, maxMessages - keepFirst - 1);
	const first = transcript.slice(0, keepFirst);
	const last = transcript.slice(-keepLast);
	const retained = new Set([...first, ...last]);
	const summaries = transcript.filter((message) => isCanonicalSummary(message) && !retained.has(message));
	const omitted = transcript.length - retained.size - summaries.length;
	const omittedMessage: AdvisorMessage = {
		role: "user",
		content: `[${omitted} earlier transcript messages omitted. Focus on the retained task framing and the most recent evidence.]`,
		timestamp: Date.now(),
	};

	return ensureAdvisorRequestClosure([contextMessage, ...first, ...summaries, omittedMessage, ...last]);
}
