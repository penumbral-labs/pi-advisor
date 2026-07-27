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

import { DEFAULT_NUDGE_CONFIG, shouldNudge, type NudgeConfig } from "./advisor-messages.js";
import {
	loadAdvisorConfig,
	resolveAdvisorEntry,
	type AdvisorConfig,
} from "./advisor/config.js";

import { resetRunToolEvents, type RunToolEvent } from "./advisor/execution-context.js";
import { getAdvisorUsesThisRun, resetAdvisorUsage } from "./advisor/execute.js";

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

export { MAX_USES_PER_RUN_DEFAULT } from "./advisor/execute.js";
export type { RunToolEvent } from "./advisor/execution-context.js";
export { executeAdvisor } from "./advisor/execute.js";

interface NudgeRuntimeState {
	sessionToolCallCount?: number;
	sessionLastNudgeAtCount?: number;
}
const NUDGE_STATE_KEY = Symbol.for("penumbral-pi-advisor-nudge");
function getNudgeRuntimeState(): NudgeRuntimeState {
	const root = globalThis as unknown as { [NUDGE_STATE_KEY]?: NudgeRuntimeState };
	return root[NUDGE_STATE_KEY] ??= {};
}

let nudgedThisRun = false;
export { getRunToolEvents, pushRunToolEvent } from "./advisor/execution-context.js";
export function getUsesThisRun(): number { return getAdvisorUsesThisRun(); }
export function getNudgedThisRun(): boolean { return nudgedThisRun; }
export function setNudgedThisRun(value: boolean): void { nudgedThisRun = value; }
export function resetRunState(): void { resetRunToolEvents(); resetAdvisorUsage(); nudgedThisRun = false; }
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
// Tool execution tracking retained until nudges are extracted.
// ---------------------------------------------------------------------------

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
