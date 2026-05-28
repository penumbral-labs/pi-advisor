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

export type ExecutorSignals = {
	phase: "exploring" | "mutating" | "verifying" | "stuck";
	mutationsCount: number;
	verificationCommands: string[];
	recentFailures: string[];
};

function buildContextPolicy(): string {
	return `Context policy:
- Assistant tool calls are stripped from the transcript below.
- Tool results are not replayed.
- User task framing is retained where possible.
- If truncated: earliest messages omitted, focus on recent evidence.`;
}

export function isVerificationCommand(command?: string): boolean {
	if (!command) return false;
	return /\b(test|tests|jest|vitest|pytest|rspec|cargo test|go test|npm run test|npm test|pnpm test|pnpm run test|yarn test|check|lint|typecheck|tsc|build)\b/i.test(command);
}

// ---------------------------------------------------------------------------
// Nudge config — thresholds for the three automatic advisory triggers.
// Backoff (min tool calls between nudges) lives here too but is enforced by
// the session-level counter in index.ts, not inside shouldNudge itself.
// ---------------------------------------------------------------------------

export interface NudgeConfig {
	/** Disable all nudges for this executor. Useful for strong models that need less hand-holding. Default: false */
	disabled?: boolean;
	/** Minimum exploration calls (read/bash) before first mutation to fire pre-execution nudge. Default: 3 */
	preExecutionMinExploration?: number;
	/** Mutation count at which the burst trigger fires. Default: 4 */
	mutationBurst?: number;
	/** Total tool-call count at which the long-run trigger fires. Default: 15 */
	longRunToolCalls?: number;
	/** Minimum session-level tool calls between nudges. Default: 20 */
	backoffToolCalls?: number;
}

export const DEFAULT_NUDGE_CONFIG = {
	disabled: false,
	preExecutionMinExploration: 3,
	mutationBurst: 4,
	longRunToolCalls: 15,
	backoffToolCalls: 20,
} satisfies Required<NudgeConfig>;

/**
 * Returns a nudge hint string when a trigger fires, or null when the agent
 * doesn't need prompting. Three triggers in priority order:
 *
 * 1. Pre-execution — first mutation after ≥N exploration calls. Fires right as
 *    the agent transitions from "figuring it out" to "writing it".
 * 2. Mutation burst — fires exactly at the Nth mutation. Catches agents that
 *    dive straight into writing without exploration.
 * 3. Long run — fires exactly at the Nth total tool call. Catches long
 *    exploration-heavy or multi-step sessions that never triggered 1 or 2.
 *
 * Caller is responsible for session-level backoff (don't call when within the
 * backoff window) and deduplication (don't call when advisor was already
 * consulted this run).
 */
export function shouldNudge(
	events: { toolName: string; command?: string }[],
	advisorCallsThisRun: number,
	advisorEnabled: boolean,
	maxUsesPerRun: number,
	cfg: NudgeConfig = DEFAULT_NUDGE_CONFIG,
): string | null {
	if (!advisorEnabled) return null;
	if (cfg.disabled) return null;
	if (advisorCallsThisRun >= maxUsesPerRun) return null;
	if (advisorCallsThisRun > 0) return null; // already consulted this run

	const preExploration = cfg.preExecutionMinExploration ?? DEFAULT_NUDGE_CONFIG.preExecutionMinExploration;
	const burstThreshold = cfg.mutationBurst ?? DEFAULT_NUDGE_CONFIG.mutationBurst;
	const longRunThreshold = cfg.longRunToolCalls ?? DEFAULT_NUDGE_CONFIG.longRunToolCalls;

	const mutationCount = events.filter((e) => e.toolName === "edit" || e.toolName === "write").length;
	const totalCalls = events.length;

	// Trigger 1: Pre-execution — fires on the exact first mutation after enough exploration.
	if (mutationCount === 1) {
		const firstMutationIdx = events.findIndex((e) => e.toolName === "edit" || e.toolName === "write");
		const explorationBefore = events
			.slice(0, firstMutationIdx)
			.filter((e) => e.toolName === "read" || e.toolName === "bash").length;
		if (explorationBefore >= preExploration) {
			return `You've started writing after ${explorationBefore} exploratory tool calls. Call \`advisor({stage: 'initial'})\` to validate your approach before going further.`;
		}
	}

	// Trigger 2: Mutation burst — fires exactly at the threshold count.
	if (mutationCount === burstThreshold) {
		return `You've made ${mutationCount} code changes without advisor guidance. Call \`advisor()\` to check your approach.`;
	}

	// Trigger 3: Long run — fires exactly at the threshold count.
	if (totalCalls === longRunThreshold) {
		return `${totalCalls} tool calls without advisor guidance. Call \`advisor()\` to check your approach.`;
	}

	return null;
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
		if (entry.type !== "message" || !("message" in entry)) continue;
		const msg = entry.message;
		if (!msg || !("role" in msg)) continue;

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
	const keepLast = maxMessages - keepFirst - 1;
	const omitted = transcript.length - keepFirst - keepLast;
	const omittedMessage: AdvisorMessage = {
		role: "user",
		content: `[${omitted} earlier transcript messages omitted. Focus on the retained task framing and the most recent evidence.]`,
		timestamp: Date.now(),
	};

	return ensureAdvisorRequestClosure([contextMessage, ...transcript.slice(0, keepFirst), omittedMessage, ...transcript.slice(-keepLast)]);
}
