/** Automatic advisor nudges, run tracking, and session-level backoff. */

import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadAdvisorConfig, onAdvisorConfigSaved, resolveAdvisorEntry, type AdvisorConfig } from "./config.js";
import { getRunToolEvents, pushRunToolEvent, resetRunToolEvents, type RunToolEvent } from "./execution-context.js";
import { getAdvisorUsesThisRun, MAX_USES_PER_RUN_DEFAULT, resetAdvisorUsage } from "./execute.js";
import { ADVISOR_TOOL_NAME } from "./messages.js";
import { getActiveExecutorKey, getAdvisorModel } from "./state.js";

export interface NudgeConfig {
	disabled?: boolean;
	preExecution?: boolean;
	preExecutionMinExploration?: number;
	mutationBurst?: number;
	longRunToolCalls?: number;
	backoffToolCalls?: number;
}

export const DEFAULT_NUDGE_CONFIG = {
	disabled: false,
	preExecution: true,
	preExecutionMinExploration: 3,
	mutationBurst: 4,
	longRunToolCalls: 15,
	backoffToolCalls: 20,
} satisfies Required<NudgeConfig>;

export const NUDGE_PRESETS = {
	heavy: { preExecution: true, mutationBurst: 2, longRunToolCalls: 8, backoffToolCalls: 10 },
	default: undefined,
	light: { preExecution: false, mutationBurst: 8, longRunToolCalls: 30, backoffToolCalls: 40 },
	off: { disabled: true },
} as const satisfies Record<"heavy" | "default" | "light" | "off", NudgeConfig | undefined>;

export type NudgePreset = keyof typeof NUDGE_PRESETS;

interface NudgeRuntimeState {
	nudgedThisRun: boolean;
	sessionToolCallCount: number;
	sessionLastNudgeAtCount?: number;
}

const NUDGE_STATE_KEY = Symbol.for("penumbral-pi-advisor-nudge");
function state(): NudgeRuntimeState {
	const root = globalThis as unknown as { [NUDGE_STATE_KEY]?: NudgeRuntimeState };
	return root[NUDGE_STATE_KEY] ??= { nudgedThisRun: false, sessionToolCallCount: 0 };
}

export function resetNudgeRunState(): void {
	resetRunToolEvents();
	resetAdvisorUsage();
	state().nudgedThisRun = false;
}

export function resetNudgeSessionState(): void {
	state().sessionToolCallCount = 0;
	state().sessionLastNudgeAtCount = undefined;
}

/** @internal Reset both scopes for isolated tests. */
export function resetNudgeStateForTests(): void {
	resetNudgeRunState();
	resetNudgeSessionState();
}

export function resolveNudgeConfig(config: AdvisorConfig, executorStub?: string): Required<NudgeConfig> {
	const entry = resolveAdvisorEntry(config, executorStub);
	return { ...DEFAULT_NUDGE_CONFIG, ...(config.nudge ?? {}), ...(entry?.nudge ?? {}) };
}

export function detectNudgePreset(nudge: NudgeConfig | undefined): NudgePreset {
	if (!nudge) return "default";
	if (nudge.disabled) return "off";
	if ((nudge.mutationBurst ?? DEFAULT_NUDGE_CONFIG.mutationBurst) <= 3) return "heavy";
	if ((nudge.mutationBurst ?? DEFAULT_NUDGE_CONFIG.mutationBurst) >= 6) return "light";
	return "default";
}

export function shouldNudge(
	events: { toolName: string; command?: string }[],
	advisorCallsThisRun: number,
	advisorEnabled: boolean,
	maxUsesPerRun: number,
	config: NudgeConfig = DEFAULT_NUDGE_CONFIG,
): string | null {
	if (!advisorEnabled || config.disabled || advisorCallsThisRun >= maxUsesPerRun || advisorCallsThisRun > 0) return null;
	const mutations = events.filter((event) => event.toolName === "edit" || event.toolName === "write");
	if ((config.preExecution ?? DEFAULT_NUDGE_CONFIG.preExecution) && mutations.length === 1) {
		const firstMutation = events.findIndex((event) => event.toolName === "edit" || event.toolName === "write");
		const exploration = events.slice(0, firstMutation).filter((event) => event.toolName === "read" || event.toolName === "bash").length;
		if (exploration >= (config.preExecutionMinExploration ?? DEFAULT_NUDGE_CONFIG.preExecutionMinExploration)) {
			return `You've started writing after ${exploration} exploratory tool calls. If independent judgment could materially change the approach, consider \`advisor({stage: 'initial'})\` before going further.`;
		}
	}
	if (mutations.length === (config.mutationBurst ?? DEFAULT_NUDGE_CONFIG.mutationBurst)) {
		return `You've made ${mutations.length} code changes. If independent judgment could materially change the approach, consider \`advisor()\`.`;
	}
	if (events.length === (config.longRunToolCalls ?? DEFAULT_NUDGE_CONFIG.longRunToolCalls)) {
		return `${events.length} tool calls into this run. If independent judgment could materially change the approach, consider \`advisor()\`.`;
	}
	return null;
}

export function cwdMatchesQuietPath(cwd: string, quietPaths: string[] | undefined, homeDir: string): boolean {
	if (!quietPaths?.length) return false;
	const expandHome = (path: string) => path === "~" ? homeDir : path.startsWith("~/") ? `${homeDir}/${path.slice(2)}` : path;
	const stripTrailing = (path: string) => path.replace(/\/+\*\*$/, "").replace(/\/+$/, "");
	const target = stripTrailing(cwd.trim());
	return quietPaths.some((raw) => {
		const base = stripTrailing(expandHome(raw.trim()));
		return Boolean(base) && (target === base || target.startsWith(`${base}/`));
	});
}

function squeezeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function resultText(result: unknown): string {
	const content = (result as { content?: unknown })?.content;
	if (!Array.isArray(content)) return "";
	return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").trim();
}

export function summarizeToolExecution(toolName: string, args: unknown, result: unknown, isError: boolean): RunToolEvent {
	const text = resultText(result);
	const path = typeof (args as { path?: unknown })?.path === "string" ? (args as { path: string }).path : "(unknown path)";
	if (toolName === "read" || toolName === "edit" || toolName === "write") {
		return { toolName, summary: `${toolName} ${path}`, isError, timestamp: Date.now() };
	}
	if (toolName === "bash") {
		const command = typeof (args as { command?: unknown })?.command === "string" ? squeezeWhitespace((args as { command: string }).command).slice(0, 140) : undefined;
		const match = text.match(/exit code:\s*(\d+)/i);
		const exitCode = match ? Number.parseInt(match[1], 10) : undefined;
		const failed = isError || (exitCode !== undefined && exitCode !== 0);
		const suffix = exitCode !== undefined ? ` (exit ${exitCode})` : isError ? " (error)" : "";
		return { toolName, summary: `$ ${command ?? "(unknown command)"}${suffix}`, command, isError: failed, timestamp: Date.now() };
	}
	const oneLine = squeezeWhitespace(text).slice(0, 140);
	return { toolName, summary: oneLine ? `${toolName}: ${oneLine}` : toolName, isError, timestamp: Date.now() };
}

export function registerAdvisorNudges(pi: ExtensionAPI): void {
	const toolArgsById = new Map<string, unknown>();
	let cachedConfig: AdvisorConfig | undefined;
	onAdvisorConfigSaved(() => { cachedConfig = undefined; });
	const configForNudges = (): AdvisorConfig => cachedConfig ??= loadAdvisorConfig();
	pi.on("agent_start", async (_event, ctx) => {
		resetNudgeRunState();
		toolArgsById.clear();
		ctx.ui.setStatus("advisor-nudge", undefined);
	});
	pi.on("tool_execution_start", async (event) => { toolArgsById.set(event.toolCallId, event.args); });
	pi.on("tool_execution_end", async (event, ctx) => {
		const args = toolArgsById.get(event.toolCallId);
		toolArgsById.delete(event.toolCallId);
		if (event.toolName === ADVISOR_TOOL_NAME) return;
		pushRunToolEvent(summarizeToolExecution(event.toolName, args, event.result, event.isError));
		const runtime = state();
		runtime.sessionToolCallCount++;
		const config = configForNudges();
		if (cwdMatchesQuietPath(ctx.cwd, config.quietPaths, homedir())) return;
		const nudge = resolveNudgeConfig(config, getActiveExecutorKey());
		if (runtime.sessionLastNudgeAtCount !== undefined && runtime.sessionToolCallCount - runtime.sessionLastNudgeAtCount < nudge.backoffToolCalls) return;
		const hint = shouldNudge(
			getRunToolEvents(),
			getAdvisorUsesThisRun(),
			getAdvisorModel() !== undefined,
			config.maxUsesPerRun ?? MAX_USES_PER_RUN_DEFAULT,
			nudge,
		);
		if (!hint || runtime.nudgedThisRun) return;
		runtime.nudgedThisRun = true;
		runtime.sessionLastNudgeAtCount = runtime.sessionToolCallCount;
		pi.sendMessage({ customType: "advisor-nudge", content: hint, display: true }, { deliverAs: "followUp" });
		ctx.ui.setStatus("advisor-nudge", "advisor nudged ↗");
	});
	pi.on("session_start", async () => resetNudgeSessionState());
}
