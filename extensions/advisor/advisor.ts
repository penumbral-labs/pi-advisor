/**
 * advisor tool + /advisor command — Advisor-strategy pattern.
 *
 * Lets the executor model consult a stronger advisor model (e.g. Opus) via an
 * in-process completeSimple() call with the full serialized conversation branch
 * as context. Advisor has no tools, never emits user-facing output, and returns
 * guidance (plan, correction, or stop signal) that the executor resumes with.
 *
 * Default state is OFF — the tool is registered at load but a before_agent_start
 * handler strips it from the active tool list each turn while no advisor model
 * is selected. /advisor opens a selector panel (ctx.ui.custom) to pick an
 * advisor model from ctx.modelRegistry.getAvailable() and toggles the tool in
 * via pi.setActiveTools(). Selection is in-memory and resets each session.
 */

import type { StopReason, Usage } from "@earendil-works/pi-ai";
import type { Message, ThinkingLevel } from "@earendil-works/pi-ai";
import {
	type AgentToolResult,
	type AgentToolUpdateCallback,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { buildAdvisorMessages, DEFAULT_NUDGE_CONFIG, isVerificationCommand, shouldNudge, type ExecutorSignals, type NudgeConfig } from "./advisor-messages.js";
import { completeAdvisor } from "./adaptive-thinking.js";
import {
	loadAdvisorConfig,
	resolveAdvisorEntry,
	type AdvisorConfig,
} from "./advisor/config.js";

import { ADVISOR_SYSTEM_PROMPT } from "./advisor/prompt.js";
import { getInventoryMessage } from "./advisor/inventory.js";
import { getRuntimeCompleteSimple, loadCompleteSimple } from "./advisor/pi-compat.js";
import {
	ERR_ABORTED_DETAIL, ERR_CALL_ABORTED, ERR_EMPTY_RESPONSE, ERR_EMPTY_RESPONSE_DETAIL,
	ERR_NO_MODEL, ERR_NO_MODEL_SELECTED, errCallFailed, errCallThrew, errMisconfigured,
	errNoApiKey, errNoApiKeyDetail, msgConsulting,
} from "./advisor/messages.js";
import { getActiveExecutorKey, getAdvisorEffort, getAdvisorModel } from "./advisor/state.js";

export { DEFAULT_PROMPT_GUIDELINES, DEFAULT_PROMPT_SNIPPET } from "./guidance.js";
export { loadAdvisorConfig, modelStubOf, resolveAdvisorEntry, saveAdvisorConfig } from "./advisor/config.js";

// ---------------------------------------------------------------------------
// Compatibility adapter state retained until execution/nudges are extracted.
// ---------------------------------------------------------------------------

export {
	ADVISOR_TOOL_NAME,
} from "./advisor/messages.js";
export { ADVISOR_SYSTEM_PROMPT } from "./advisor/prompt.js";
export { ensureUserTailForAdvisor, stripInflightAdvisorCall } from "./advisor/context.js";
export { getInventoryMessage, stableStringify } from "./advisor/inventory.js";
export {
	getActiveExecutorKey,
	getAdvisorEffort,
	getAdvisorModel,
	setAdvisorEffort,
	setAdvisorModel,
} from "./advisor/state.js";
export { applyAdvisorForExecutor, restoreAdvisorState } from "./advisor/restore.js";
export { registerAdvisorBeforeAgentStart } from "./advisor/handlers.js";

export const MAX_USES_PER_RUN_DEFAULT = 5;
const MAX_CONTEXT_MESSAGES_DEFAULT = 18;
const RECENT_TOOL_SUMMARY_COUNT = 8;

type AdvisorStage = "initial" | "recovery" | "final-check";
export interface RunToolEvent {
	toolName: string;
	summary: string;
	command?: string;
	isError: boolean;
	timestamp: number;
}

interface NudgeRuntimeState {
	sessionToolCallCount?: number;
	sessionLastNudgeAtCount?: number;
}
const NUDGE_STATE_KEY = Symbol.for("penumbral-pi-advisor-nudge");
function getNudgeRuntimeState(): NudgeRuntimeState {
	const root = globalThis as unknown as { [NUDGE_STATE_KEY]?: NudgeRuntimeState };
	return root[NUDGE_STATE_KEY] ??= {};
}

let runToolEvents: RunToolEvent[] = [];
let usesThisRun = 0;
let nudgedThisRun = false;
export function getRunToolEvents(): RunToolEvent[] { return runToolEvents; }
export function getUsesThisRun(): number { return usesThisRun; }
export function getNudgedThisRun(): boolean { return nudgedThisRun; }
export function setNudgedThisRun(value: boolean): void { nudgedThisRun = value; }
export function resetRunState(): void { runToolEvents = []; usesThisRun = 0; nudgedThisRun = false; }
export function pushRunToolEvent(event: RunToolEvent): void { runToolEvents.push(event); }
export function getSessionToolCallCount(): number { return getNudgeRuntimeState().sessionToolCallCount ?? 0; }
export function incrementSessionToolCallCount(): void {
	const state = getNudgeRuntimeState();
	state.sessionToolCallCount = (state.sessionToolCallCount ?? 0) + 1;
}
export function getSessionLastNudgeAtCount(): number | undefined { return getNudgeRuntimeState().sessionLastNudgeAtCount; }
export function setSessionLastNudgeAtCount(count: number): void { getNudgeRuntimeState().sessionLastNudgeAtCount = count; }
export function resetSessionNudgeState(): void {
	const state = getNudgeRuntimeState();
	state.sessionToolCallCount = 0;
	state.sessionLastNudgeAtCount = undefined;
}

export function resolveNudgeConfig(config: AdvisorConfig, executorStub?: string): Required<NudgeConfig> {
	const entry = resolveAdvisorEntry(config, executorStub);
	return { ...DEFAULT_NUDGE_CONFIG, ...(config.nudge ?? {}), ...(entry?.nudge ?? {}) };
}

// ---------------------------------------------------------------------------
// Core execute logic — curate context, call advisor, return structured result
// ---------------------------------------------------------------------------

export interface AdvisorDetails {
	advisorModel?: string;
	effort?: ThinkingLevel;
	usage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
}

function buildErrorResult(
	advisorLabel: string | undefined,
	userText: string,
	errorMessage: string,
): AgentToolResult<AdvisorDetails> {
	const effort = getAdvisorEffort();
	return {
		content: [{ type: "text", text: userText }],
		details: advisorLabel ? { advisorModel: advisorLabel, effort, errorMessage } : { effort, errorMessage },
	};
}

function squeezeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function extractPrimaryText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return (content as Array<{ type?: string; text?: string }>)
		.filter((b) => b?.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("\n")
		.trim();
}

function extractBashExitCode(text: string): number | undefined {
	const match = text.match(/exit code:\s*(\d+)/i);
	if (!match) return undefined;
	const code = Number.parseInt(match[1], 10);
	return Number.isNaN(code) ? undefined : code;
}

export function summarizeToolExecution(toolName: string, args: unknown, result: unknown, isError: boolean): RunToolEvent {
	const text = extractPrimaryText((result as { content?: unknown })?.content);
	const oneLine = squeezeWhitespace(text).slice(0, 140);
	switch (toolName) {
		case "read": {
			const path = typeof (args as { path?: unknown })?.path === "string"
				? (args as { path: string }).path
				: "(unknown path)";
			return { toolName, summary: `read ${path}`, isError, timestamp: Date.now() };
		}
		case "edit":
		case "write": {
			const path = typeof (args as { path?: unknown })?.path === "string"
				? (args as { path: string }).path
				: "(unknown path)";
			return { toolName, summary: `${toolName} ${path}`, isError, timestamp: Date.now() };
		}
		case "bash": {
			const command = typeof (args as { command?: unknown })?.command === "string"
				? squeezeWhitespace((args as { command: string }).command).slice(0, 140)
				: undefined;
			const exitCode = extractBashExitCode(text);
			const suffix = exitCode !== undefined ? ` (exit ${exitCode})` : isError ? " (error)" : "";
			return {
				toolName,
				summary: `$ ${command ?? "(unknown command)"}${suffix}`,
				command,
				isError: isError || (exitCode !== undefined && exitCode !== 0),
				timestamp: Date.now(),
			};
		}
		default:
			return {
				toolName,
				summary: oneLine ? `${toolName}: ${oneLine}` : toolName,
				isError,
				timestamp: Date.now(),
			};
	}
}

function buildRecentToolActivity(events: RunToolEvent[]): string {
	if (events.length === 0) return "";
	return events
		.slice(-RECENT_TOOL_SUMMARY_COUNT)
		.map((e) => `- ${e.summary}`)
		.join("\n");
}

function buildExecutorSignals(events: RunToolEvent[]): ExecutorSignals {
	const mutationsCount = events.filter((e) => e.toolName === "edit" || e.toolName === "write").length;
	const verificationCommands = events
		.filter((e) => e.toolName === "bash" && isVerificationCommand(e.command))
		.map((e) => e.command!);
	const recentFailures = events
		.filter((e) => e.isError)
		.slice(-3)
		.map((e) => e.summary);
	let phase: ExecutorSignals["phase"] = "exploring";
	if (mutationsCount > 0 && verificationCommands.length > 0) {
		phase = "verifying";
	} else if (mutationsCount > 0) {
		phase = "mutating";
	} else if (recentFailures.length > 0) {
		phase = "stuck";
	}
	return { phase, mutationsCount, verificationCommands, recentFailures };
}

function detectStage(events: RunToolEvent[], advisorCallsThisRun: number): { stage: AdvisorStage; reason: string } {
	const hasMutation = events.some((e) => e.toolName === "edit" || e.toolName === "write");
	const hasVerification = events.some((e) => e.toolName === "bash" && isVerificationCommand(e.command));
	const recentFailure = [...events].reverse().find((e) => e.isError);
	const explorationCount = events.filter((e) => e.toolName === "read" || e.toolName === "bash").length;
	if (hasMutation && hasVerification) {
		return { stage: "final-check", reason: "Implementation changes exist and verification output is already in the transcript." };
	}
	if (recentFailure) {
		return { stage: "recovery", reason: `Recent failure signal: ${recentFailure.summary}` };
	}
	if (hasMutation && advisorCallsThisRun > 1) {
		return { stage: "recovery", reason: "Implementation has started and the executor is checking course again before finishing." };
	}
	if (!hasMutation && explorationCount >= 2) {
		return { stage: "initial", reason: "Exploratory reads or commands have happened, but the executor has not committed to file changes yet." };
	}
	if (hasMutation) {
		return { stage: "recovery", reason: "Implementation is in progress, but there is not enough verification evidence yet for a final check." };
	}
	return { stage: "initial", reason: "The executor is still in the early orientation phase." };
}

async function executeAdvisor(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AdvisorDetails> | undefined,
	stageOverride?: AdvisorStage,
): Promise<AgentToolResult<AdvisorDetails>> {
	const config = loadAdvisorConfig();
	const maxUsesPerRun = config.maxUsesPerRun ?? MAX_USES_PER_RUN_DEFAULT;
	const maxContextMessages = config.maxContextMessages ?? MAX_CONTEXT_MESSAGES_DEFAULT;

	if (usesThisRun >= maxUsesPerRun) {
		return {
			content: [{ type: "text", text: `Advisor usage limit reached (${maxUsesPerRun} per run). Continue without advisor guidance.` }],
			details: { effort: getAdvisorEffort(), errorMessage: "max_uses_exceeded" },
		};
	}
	usesThisRun++;

	const advisor = getAdvisorModel();
	if (!advisor) {
		return buildErrorResult(undefined, ERR_NO_MODEL, ERR_NO_MODEL_SELECTED);
	}
	const advisorLabel = `${advisor.provider}:${advisor.id}`;
	const effort = getAdvisorEffort();

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
	if (!auth.ok) {
		return buildErrorResult(advisorLabel, errMisconfigured(advisorLabel, auth.error), auth.error);
	}
	if (!auth.apiKey) {
		return buildErrorResult(advisorLabel, errNoApiKey(advisorLabel), errNoApiKeyDetail(advisor.provider));
	}

	const stageInfo = stageOverride
		? { stage: stageOverride, reason: "Executor explicitly signaled this stage." }
		: detectStage(runToolEvents, usesThisRun);
	const recentToolActivity = buildRecentToolActivity(runToolEvents);
	const signals = buildExecutorSignals(runToolEvents);
	// Curated transcript: strips tool results + toolCall blocks, clamps long text,
	// windows to first+last N messages. In-flight advisor call and user-tail
	// normalization handled internally by buildAdvisorMessages.
	const branch = ctx.sessionManager.getBranch();
	const advisorMessages = buildAdvisorMessages(
		branch as unknown as Parameters<typeof buildAdvisorMessages>[0],
		stageInfo,
		recentToolActivity,
		maxContextMessages,
		signals,
	) as unknown as Message[];
	if (advisorMessages.length === 0) {
		return buildErrorResult(advisorLabel, "No conversation context available for advisor. Continue without advice.", "no_context");
	}
	const inventoryMessage = getInventoryMessage(pi.getAllTools());
	const messages: Message[] = inventoryMessage ? [inventoryMessage, ...advisorMessages] : advisorMessages;

	onUpdate?.({
		content: [{ type: "text", text: msgConsulting(advisorLabel, effort) }],
		details: { advisorModel: advisorLabel, effort },
	});

	try {
		const runtimeComplete = getRuntimeCompleteSimple(ctx.modelRegistry);
		const complete = runtimeComplete ?? await loadCompleteSimple();
		const options = runtimeComplete
			? { signal, reasoning: effort }
			: { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort };
		const response = await completeAdvisor(
			advisor,
			// `tools: []` reaffirms the "never calls tools" contract even when
			// `messages` contains prior toolCall/toolResult blocks (btw.ts:235).
			{ systemPrompt: ADVISOR_SYSTEM_PROMPT, messages, tools: [] },
			options,
			complete,
		);

		if (response.stopReason === "aborted") {
			return {
				content: [{ type: "text", text: ERR_CALL_ABORTED }],
				details: {
					advisorModel: advisorLabel,
					effort,
					usage: response.usage,
					stopReason: response.stopReason,
					errorMessage: response.errorMessage ?? ERR_ABORTED_DETAIL,
				},
			};
		}

		if (response.stopReason === "error") {
			return {
				content: [{ type: "text", text: errCallFailed(response.errorMessage) }],
				details: {
					advisorModel: advisorLabel,
					effort,
					usage: response.usage,
					stopReason: response.stopReason,
					errorMessage: response.errorMessage,
				},
			};
		}

		const advisorText = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();

		if (!advisorText) {
			return {
				content: [{ type: "text", text: ERR_EMPTY_RESPONSE }],
				details: {
					advisorModel: advisorLabel,
					effort,
					usage: response.usage,
					stopReason: response.stopReason,
					errorMessage: ERR_EMPTY_RESPONSE_DETAIL,
				},
			};
		}

		return {
			content: [{ type: "text", text: advisorText }],
			details: {
				advisorModel: advisorLabel,
				effort,
				usage: response.usage,
				stopReason: response.stopReason,
			},
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return buildErrorResult(advisorLabel, errCallThrew(message), message);
	}
}
