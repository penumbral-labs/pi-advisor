/** Canonical-context advisor completion with structured result envelopes. */

import type { AssistantMessage, Message, StopReason, ThinkingLevel, Usage } from "@earendil-works/pi-ai";
import {
	buildSessionContext,
	convertToLlm,
	type AgentToolResult,
	type AgentToolUpdateCallback,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { completeAdvisor } from "../adaptive-thinking.js";
import { loadAdvisorConfig } from "./config.js";
import { ensureUserTailForAdvisor, stripInflightAdvisorCall } from "./context.js";
import { curateAdvisorMessages } from "./curation.js";
import { type AdvisorStage, buildExecutorContext, getRunToolEvents } from "./execution-context.js";
import { getInventoryMessage } from "./inventory.js";
import {
	ERR_ABORTED_DETAIL,
	ERR_CALL_ABORTED,
	ERR_EMPTY_RESPONSE,
	ERR_EMPTY_RESPONSE_DETAIL,
	ERR_NO_MODEL,
	ERR_NO_MODEL_SELECTED,
	errCallFailed,
	errCallThrew,
	errMisconfigured,
	errNoApiKey,
	errNoApiKeyDetail,
	msgConsulting,
} from "./messages.js";
import { getRuntimeCompleteSimple, loadCompleteSimple } from "./pi-compat.js";
import { ADVISOR_SYSTEM_PROMPT } from "./prompt.js";
import { getAdvisorEffort, getAdvisorModel } from "./state.js";

export const MAX_USES_PER_RUN_DEFAULT = 5;
const MAX_CONTEXT_MESSAGES_DEFAULT = 18;

export interface AdvisorDetails {
	advisorModel?: string;
	effort?: ThinkingLevel;
	usage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
}

let usesThisRun = 0;

export function getAdvisorUsesThisRun(): number {
	return usesThisRun;
}

export function resetAdvisorUsage(): void {
	usesThisRun = 0;
}

function advisorTextFromResponse(response: AssistantMessage): string {
	return response.content
		.filter((content): content is { type: "text"; text: string } => content.type === "text")
		.map((content) => content.text)
		.join("\n")
		.trim();
}

function terminalResponseResult(
	response: AssistantMessage,
	advisorLabel: string,
	effort: ThinkingLevel | undefined,
): AgentToolResult<AdvisorDetails> | undefined {
	if (response.stopReason === "aborted") {
		return buildAdvisorResult({
			text: ERR_CALL_ABORTED,
			effort,
			advisorLabel,
			usage: response.usage,
			stopReason: response.stopReason,
			errorMessage: response.errorMessage ?? ERR_ABORTED_DETAIL,
		});
	}
	if (response.stopReason === "error") {
		return buildAdvisorResult({
			text: errCallFailed(response.errorMessage),
			effort,
			advisorLabel,
			usage: response.usage,
			stopReason: response.stopReason,
			errorMessage: response.errorMessage,
		});
	}
	return undefined;
}

function buildAdvisorResult(opts: {
	text: string;
	effort: ThinkingLevel | undefined;
	advisorLabel?: string;
	usage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
}): AgentToolResult<AdvisorDetails> {
	const details: AdvisorDetails = { effort: opts.effort };
	if (opts.advisorLabel !== undefined) details.advisorModel = opts.advisorLabel;
	if (opts.usage !== undefined) details.usage = opts.usage;
	if (opts.stopReason !== undefined) details.stopReason = opts.stopReason;
	if (opts.errorMessage !== undefined) details.errorMessage = opts.errorMessage;
	return { content: [{ type: "text", text: opts.text }], details };
}

function buildErrorResult(
	advisorLabel: string | undefined,
	effort: ThinkingLevel | undefined,
	userText: string,
	errorMessage: string,
): AgentToolResult<AdvisorDetails> {
	return buildAdvisorResult({ text: userText, effort, advisorLabel, errorMessage });
}

export async function executeAdvisor(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AdvisorDetails> | undefined,
	stageOverride?: AdvisorStage,
): Promise<AgentToolResult<AdvisorDetails>> {
	const config = loadAdvisorConfig();
	const maxUsesPerRun = config.maxUsesPerRun ?? MAX_USES_PER_RUN_DEFAULT;
	const effort = getAdvisorEffort();
	if (usesThisRun >= maxUsesPerRun) {
		return buildErrorResult(
			undefined,
			effort,
			`Advisor usage limit reached (${maxUsesPerRun} per run). Continue without advisor guidance.`,
			"max_uses_exceeded",
		);
	}
	const callNumber = ++usesThisRun;
	const releaseReservation = (): void => { usesThisRun--; };

	const advisor = getAdvisorModel();
	if (!advisor) {
		releaseReservation();
		return buildErrorResult(undefined, effort, ERR_NO_MODEL, ERR_NO_MODEL_SELECTED);
	}
	const advisorLabel = `${advisor.provider}:${advisor.id}`;

	let auth;
	try {
		auth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
	} catch (error) {
		releaseReservation();
		const message = error instanceof Error ? error.message : String(error);
		return buildErrorResult(advisorLabel, effort, errCallThrew(message), message);
	}
	if (!auth.ok) {
		releaseReservation();
		return buildErrorResult(advisorLabel, effort, errMisconfigured(advisorLabel, auth.error), auth.error);
	}
	const runtimeComplete = getRuntimeCompleteSimple(ctx.modelRegistry);
	if (!auth.apiKey && !runtimeComplete) {
		releaseReservation();
		return buildErrorResult(advisorLabel, effort, errNoApiKey(advisorLabel), errNoApiKeyDetail(advisor.provider));
	}

	const { messages: sessionMessages } = buildSessionContext(
		ctx.sessionManager.getEntries(),
		ctx.sessionManager.getLeafId(),
	);
	const canonicalMessages = stripInflightAdvisorCall(convertToLlm(sessionMessages));
	const executionContext = buildExecutorContext(getRunToolEvents(), callNumber, stageOverride);
	const curatedMessages = curateAdvisorMessages(
		canonicalMessages,
		executionContext.stageInfo,
		executionContext.recentToolActivity,
		config.maxContextMessages ?? MAX_CONTEXT_MESSAGES_DEFAULT,
		executionContext.signals,
	);
	const branchMessages = ensureUserTailForAdvisor(curatedMessages);
	if (branchMessages.length === 0) {
		releaseReservation();
		return buildErrorResult(
			advisorLabel,
			effort,
			"No conversation context available for advisor. Continue without advice.",
			"no_context",
		);
	}
	const inventoryMessage = getInventoryMessage(pi.getAllTools());
	const messages: Message[] = inventoryMessage ? [inventoryMessage, ...branchMessages] : branchMessages;

	let complete = runtimeComplete;
	if (!complete) {
		try {
			complete = await loadCompleteSimple();
		} catch (error) {
			releaseReservation();
			const message = error instanceof Error ? error.message : String(error);
			return buildErrorResult(advisorLabel, effort, errCallThrew(message), message);
		}
	}
	const options = runtimeComplete
		? { signal, reasoning: effort }
		: { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort };

	try {
		onUpdate?.({
			content: [{ type: "text", text: msgConsulting(advisorLabel, effort) }],
			details: { advisorModel: advisorLabel, effort },
		});
		const advisorContext = { systemPrompt: ADVISOR_SYSTEM_PROMPT, messages, tools: [] };
		const callAdvisor = () => completeAdvisor(advisor, advisorContext, options, complete);

		let response = await callAdvisor();
		const firstTerminal = terminalResponseResult(response, advisorLabel, effort);
		if (firstTerminal) return firstTerminal;

		let advisorText = advisorTextFromResponse(response);
		if (!advisorText) {
			response = await callAdvisor();
			const retryTerminal = terminalResponseResult(response, advisorLabel, effort);
			if (retryTerminal) return retryTerminal;
			advisorText = advisorTextFromResponse(response);
			if (!advisorText) {
				return buildAdvisorResult({
					text: ERR_EMPTY_RESPONSE,
					effort,
					advisorLabel,
					usage: response.usage,
					stopReason: response.stopReason,
					errorMessage: ERR_EMPTY_RESPONSE_DETAIL,
				});
			}
		}
		return buildAdvisorResult({
			text: advisorText,
			effort,
			advisorLabel,
			usage: response.usage,
			stopReason: response.stopReason,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return buildErrorResult(advisorLabel, effort, errCallThrew(message), message);
	}
}
