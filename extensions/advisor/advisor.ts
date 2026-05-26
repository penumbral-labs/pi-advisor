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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Api, Model, StopReason, Usage } from "@earendil-works/pi-ai";
import { completeSimple, getSupportedThinkingLevels, type Message, type ThinkingLevel } from "@earendil-works/pi-ai";
import {
	type AgentToolResult,
	type AgentToolUpdateCallback,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { buildAdvisorMessages, isVerificationCommand, shouldNudge, type ExecutorSignals } from "./advisor-messages.js";
import type { SelectItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { showAdvisorPicker, showEffortPicker, showMappingsPicker } from "./advisor-ui.js";

// ---------------------------------------------------------------------------
// Constants — grouped by concern, flat named consts (no namespaced objects)
// ---------------------------------------------------------------------------

// Tool identity
export const ADVISOR_TOOL_NAME = "advisor";
const TOOL_LABEL = "Advisor";

// Persistence — colocates with other pi-plugin config under ~/.pi/agent/.
// File contains only model identifiers and effort strings (no credentials),
// so it uses default 0644 perms like the rest of ~/.pi/agent/.
const ADVISOR_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-advisor.json");

// Selector sentinels — double-underscore form is collision-proof against real provider:id keys
const NO_ADVISOR_VALUE = "__no_advisor__";
const OFF_VALUE = "__off__";
const DEFAULT_EXECUTOR_VALUE = "__default__";

// Effort levels
const BASE_EFFORT_LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high"];
const XHIGH_EFFORT_LEVEL: ThinkingLevel = "xhigh";
const DEFAULT_EFFORT: ThinkingLevel = "high";
const RECOMMENDED_EFFORT_SUFFIX = "  (recommended)";

// UI — labels used by command flow; panel prose/titles live in advisor-ui.ts
const CHECKMARK = " ✓";

// Messages (static)
const MSG_ADVISOR_DISABLED = "Advisor disabled";
const MSG_NO_ADVISOR_FOR_EXECUTOR = "No advisor configured for this executor; advisor disabled.";
const MSG_REQUIRES_INTERACTIVE = "/advisor requires interactive mode";
const MSG_ADVISOR_NUDGE = "Please advise on the executor's situation above.";

// Errors (static)
const ERR_NO_MODEL = "No advisor model is configured. The user can enable one with the /advisor command.";
const ERR_CALL_ABORTED = "Advisor call was cancelled before it completed.";
const ERR_EMPTY_RESPONSE = "Advisor returned no text content.";
const ERR_NO_MODEL_SELECTED = "no advisor model selected";
const ERR_EMPTY_RESPONSE_DETAIL = "empty response";
const ERR_ABORTED_DETAIL = "aborted";
const ERR_UNKNOWN = "unknown error";

// Errors/messages (parameterized)
const errMisconfigured = (label: string, err: string) => `Advisor (${label}) is misconfigured: ${err}`;
const errNoApiKey = (label: string) => `Advisor (${label}) has no API key available.`;
const errNoApiKeyDetail = (provider: string) => `no API key for ${provider}`;
const errCallFailed = (err: string | undefined) => `Advisor call failed: ${err ?? ERR_UNKNOWN}`;
const errCallThrew = (msg: string) => `Advisor call threw: ${msg}`;
const errSelectionNotFound = (choice: string) => `Advisor selection not found: ${choice}`;
const errModelUnavailable = (key: string) => `Previously configured advisor model ${key} is no longer available`;
const msgAdvisorEnabled = (label: string, effort: ThinkingLevel | undefined, executorKey?: string) =>
	`Advisor: ${label}${effort ? `, ${effort}` : ""}${executorKey ? ` (for ${executorKey})` : ""}`;
const msgAdvisorRestored = (label: string, effort: ThinkingLevel | undefined, executorKey?: string) =>
	`Advisor restored: ${label}${effort ? `, ${effort}` : ""}${executorKey ? ` (for ${executorKey})` : ""}`;
const msgAdvisorSwapped = (label: string, effort: ThinkingLevel | undefined, executorKey: string) =>
	`Advisor swapped to ${label}${effort ? `, ${effort}` : ""} (executor: ${executorKey})`;
const msgSavedForExecutor = (executorStub: string, advisorStub: string, effort: ThinkingLevel | undefined) =>
	`Saved for ${executorStub}: ${advisorStub}${effort ? ` / ${effort}` : ""}`;
const msgClearedForExecutor = (executorStub: string) =>
	`Advisor cleared for ${executorStub}`;
const msgConsulting = (label: string, effort: ThinkingLevel | undefined) =>
	`Consulting advisor (${label}${effort ? `, ${effort}` : ""})…`;

// Run-level defaults
export const MAX_USES_PER_RUN_DEFAULT = 5;
const MAX_CONTEXT_MESSAGES_DEFAULT = 18;
const RECENT_TOOL_SUMMARY_COUNT = 8;

// Stage type and run-event record
type AdvisorStage = "initial" | "recovery" | "final-check";

export interface RunToolEvent {
	toolName: string;
	summary: string;
	command?: string;
	isError: boolean;
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Config file persistence (cross-session)
// ---------------------------------------------------------------------------

interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

interface AdvisorEntry {
	modelStub?: string;
	effort?: ThinkingLevel;
}

interface AdvisorConfig {
	/** Default advisor when no per-executor entry matches. */
	default?: AdvisorEntry;
	/** Per-executor advisor mapping, indexed by `<provider>:<modelId>` stub. */
	byExecutor?: Record<string, AdvisorEntry>;
	guidance?: GuidanceFields;
	/** Max advisor calls per agent run (default: 5). */
	maxUsesPerRun?: number;
	/** Max transcript messages forwarded to advisor (default: 18). */
	maxContextMessages?: number;
}

export function loadAdvisorConfig(): AdvisorConfig {
	if (!existsSync(ADVISOR_CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(ADVISOR_CONFIG_PATH, "utf-8")) as AdvisorConfig;
	} catch {
		return {};
	}
}

/**
 * Resolve the advisor entry to use for a given executor stub.
 * `byExecutor[executorStub]` first, falling back to `default`. Returns
 * undefined when nothing resolves — caller treats that as "advisor off".
 */
export function resolveAdvisorEntry(
	config: AdvisorConfig,
	executorStub: string | undefined,
): AdvisorEntry | undefined {
	if (executorStub) {
		const per = config.byExecutor?.[executorStub];
		if (per?.modelStub) return per;
	}
	if (config.default?.modelStub) return config.default;
	return undefined;
}

function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!fields || typeof fields !== "object") return {};
	const g = fields as Record<string, unknown>;
	const result: GuidanceFields = {};
	if (typeof g.promptSnippet === "string" && g.promptSnippet.length > 0) {
		result.promptSnippet = g.promptSnippet;
	}
	if (
		Array.isArray(g.promptGuidelines) &&
		g.promptGuidelines.length > 0 &&
		g.promptGuidelines.every((s) => typeof s === "string" && s.length > 0)
	) {
		result.promptGuidelines = g.promptGuidelines;
	}
	return result;
}

function writeAdvisorConfig(config: AdvisorConfig): void {
	try {
		mkdirSync(dirname(ADVISOR_CONFIG_PATH), { recursive: true });
		writeFileSync(ADVISOR_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
	} catch {
		// write may fail on disk-full or permission errors — best effort only
	}
}

/**
 * Persist an advisor selection.
 *
 * - When executorStub is provided: writes under `byExecutor[executorStub]`
 *   and ALSO seeds `default` if no default exists yet (so first-time setup
 *   produces sane behavior across all executors until the user configures
 *   more). When stub is undefined, the executor entry is removed.
 * - When executorStub is undefined: writes (or clears) the global `default`.
 */
export function saveAdvisorConfig(
	stub: string | undefined,
	effort: ThinkingLevel | undefined,
	executorStub: string | undefined,
): void {
	const existing = loadAdvisorConfig();
	const config: AdvisorConfig = {
		default: existing.default,
		byExecutor: { ...(existing.byExecutor ?? {}) },
		guidance: existing.guidance,
	};

	if (executorStub) {
		if (stub) {
			config.byExecutor![executorStub] = effort ? { modelStub: stub, effort } : { modelStub: stub };
			if (!config.default?.modelStub) {
				config.default = effort ? { modelStub: stub, effort } : { modelStub: stub };
			}
		} else {
			delete config.byExecutor![executorStub];
		}
	} else {
		if (stub) {
			config.default = effort ? { modelStub: stub, effort } : { modelStub: stub };
		} else {
			delete config.default;
		}
	}

	if (config.byExecutor && Object.keys(config.byExecutor).length === 0) delete config.byExecutor;
	if (!config.default) delete config.default;
	if (!config.guidance) delete config.guidance;

	writeAdvisorConfig(config);
}

function parseModelStub(stub: string): { provider: string; modelId: string } | undefined {
	const idx = stub.indexOf(":");
	if (idx < 1) return undefined;
	return { provider: stub.slice(0, idx), modelId: stub.slice(idx + 1) };
}

export function modelStubOf(model: { provider: string; id: string } | undefined): string | undefined {
	if (!model) return undefined;
	return `${model.provider}:${model.id}`;
}

// ---------------------------------------------------------------------------
// System prompt — loaded once at module init from prompts/advisor-system.txt
// ---------------------------------------------------------------------------

export const ADVISOR_SYSTEM_PROMPT = readFileSync(
	fileURLToPath(new URL("./prompts/advisor-system.txt", import.meta.url)),
	"utf-8",
).trimEnd();

// ---------------------------------------------------------------------------
// Inventory state + serializer — stable tool-inventory Message for cache parity
//
// globalThis-keyed to survive module re-import on /new, /fork, /resume (mirrors
// rpiv-btw/btw.ts:37, 87-98). Single-slot cache — the Pi tool registry is
// process-scoped, so per-session keying would be redundant. Cache invalidates
// only when the set of registered tool names changes.
// ---------------------------------------------------------------------------

const ADVISOR_STATE_KEY = Symbol.for("penumbral-pi-advisor");

interface AdvisorState {
	inventorySignature?: string;
	inventoryMessage?: Message;
	/** Executor key the current advisor was last resolved for. Survives module re-import on /new, /fork, /resume. */
	activeExecutorKey?: string;
}

function getAdvisorRuntimeState(): AdvisorState {
	const g = globalThis as unknown as { [k: symbol]: AdvisorState | undefined };
	let state = g[ADVISOR_STATE_KEY];
	if (!state) {
		state = {};
		g[ADVISOR_STATE_KEY] = state;
	}
	return state;
}

// Recursive key-sorted JSON serializer — matches JSON.stringify semantics
// (drops `undefined` in objects, emits `null` for `undefined` in arrays) but
// guarantees stable key ordering across V8 insertion-order variation. Required
// because nested TypeBox schemas may be authored in any order, and prompt
// caching is byte-sensitive.
export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const entries: string[] = [];
	for (const k of Object.keys(obj).sort()) {
		const v = obj[k];
		if (v === undefined) continue;
		entries.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
	}
	return `{${entries.join(",")}}`;
}

function buildInventoryBlock(tools: ToolInfo[]): string {
	// Omit `sourceInfo` — its `path` field is install-location-dependent and
	// would bust cache parity across machines/reinstalls.
	return tools
		.map((t) => `### ${t.name}\n${t.description}\n\nParameters: ${stableStringify(t.parameters)}`)
		.join("\n\n---\n\n");
}

// Strip the executor's in-flight advisor() toolCall from the tail assistant
// message. That call is what invoked *us* — there is no matching toolResult
// yet, and providers (Anthropic, GLM/zai, OpenAI) reject payloads with orphan
// toolCalls. Name-targeted to leave any other trailing toolCalls visible.
export function stripInflightAdvisorCall(messages: Message[]): Message[] {
	if (messages.length === 0) return messages;
	const last = messages[messages.length - 1];
	if (last.role !== "assistant") return messages;
	const filtered = last.content.filter((c) => !(c.type === "toolCall" && c.name === ADVISOR_TOOL_NAME));
	if (filtered.length === last.content.length) return messages;
	if (filtered.length === 0) return messages.slice(0, -1);
	return [...messages.slice(0, -1), { ...last, content: filtered }];
}

// Some providers (recent Anthropic Claude models) reject payloads ending on an
// assistant turn ("This model does not support assistant message prefill. The
// conversation must end with a user message."). After stripInflightAdvisorCall
// the tail can be assistant (e.g. the executor wrote thinking text before
// calling advisor). Append a minimal user-role nudge to guarantee user-tail.
export function ensureUserTailForAdvisor(messages: Message[]): Message[] {
	if (messages.length === 0) return messages;
	const last = messages[messages.length - 1];
	if (last.role !== "assistant") return messages;
	const nudge: Message = {
		role: "user",
		content: [{ type: "text", text: MSG_ADVISOR_NUDGE }],
		timestamp: Date.now(),
	};
	return [...messages, nudge];
}

// Returns `undefined` when the registry is empty (no extensions loaded) so
// callers can skip prepending an empty block that would still cost a cache unit.
export function getInventoryMessage(tools: ToolInfo[]): Message | undefined {
	if (tools.length === 0) return undefined;
	const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	const signature = sorted.map((t) => t.name).join("|");
	const state = getAdvisorRuntimeState();
	if (state.inventorySignature === signature && state.inventoryMessage) {
		return state.inventoryMessage;
	}
	const text = `## Available Executor Tools\n\n${buildInventoryBlock(sorted)}`;
	const message: Message = {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
	state.inventorySignature = signature;
	state.inventoryMessage = message;
	return message;
}

// ---------------------------------------------------------------------------
// Module state — in-memory, resets each session
// ---------------------------------------------------------------------------

let selectedAdvisor: Model<Api> | undefined;
let selectedAdvisorEffort: ThinkingLevel | undefined;

export function getAdvisorModel(): Model<Api> | undefined {
	return selectedAdvisor;
}

export function setAdvisorModel(model: Model<Api> | undefined): void {
	selectedAdvisor = model;
}

export function getAdvisorEffort(): ThinkingLevel | undefined {
	return selectedAdvisorEffort;
}

export function setAdvisorEffort(effort: ThinkingLevel | undefined): void {
	selectedAdvisorEffort = effort;
}

// Run-level state — reset each agent run via resetRunState() in agent_start handler.
let runToolEvents: RunToolEvent[] = [];
let usesThisRun = 0;
// Tracks whether we've already injected the agent-facing nudge this run, so a
// long edit streak doesn't pile up duplicate nudges in the model's context.
let nudgedThisRun = false;

export function getRunToolEvents(): RunToolEvent[] { return runToolEvents; }
export function getUsesThisRun(): number { return usesThisRun; }
export function getNudgedThisRun(): boolean { return nudgedThisRun; }
export function setNudgedThisRun(value: boolean): void { nudgedThisRun = value; }
export function resetRunState(): void { runToolEvents = []; usesThisRun = 0; nudgedThisRun = false; }
export function pushRunToolEvent(event: RunToolEvent): void { runToolEvents.push(event); }



// ---------------------------------------------------------------------------
// Apply / restore — used by session_start and model_select handlers
// ---------------------------------------------------------------------------

function ensureToolActive(pi: ExtensionAPI, active: boolean): void {
	const tools = pi.getActiveTools();
	const has = tools.includes(ADVISOR_TOOL_NAME);
	if (active && !has) {
		pi.setActiveTools([...tools, ADVISOR_TOOL_NAME]);
	} else if (!active && has) {
		pi.setActiveTools(tools.filter((n) => n !== ADVISOR_TOOL_NAME));
	}
}

/**
 * Resolve and apply the advisor for the given executor model.
 *
 * `reason` controls the notification shape:
 *   - "restore": initial session_start ("Advisor restored: ...")
 *   - "swap":    user changed executor mid-session ("Advisor swapped to ...")
 *
 * No-ops if the resolved advisor is unchanged from the currently selected one.
 */
export function applyAdvisorForExecutor(
	executor: Model<Api> | undefined,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	reason: "restore" | "swap",
): void {
	const executorStub = modelStubOf(executor);
	const config = loadAdvisorConfig();
	const entry = resolveAdvisorEntry(config, executorStub);

	const previousAdvisor = getAdvisorModel();
	const previousAdvisorStub = modelStubOf(previousAdvisor);
	const previousEffort = getAdvisorEffort();
	const runtime = getAdvisorRuntimeState();
	const previousExecutorStub = runtime.activeExecutorKey;

	runtime.activeExecutorKey = executorStub;

	if (!entry?.modelStub) {
		// No advisor for this executor — disable cleanly.
		setAdvisorModel(undefined);
		setAdvisorEffort(undefined);
		ensureToolActive(pi, false);
		if (reason === "swap" && previousAdvisor && ctx.hasUI && executorStub !== previousExecutorStub) {
			ctx.ui.notify(MSG_NO_ADVISOR_FOR_EXECUTOR, "info");
		}
		return;
	}

	const parsed = parseModelStub(entry.modelStub);
	if (!parsed) return;

	const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
	if (!model) {
		setAdvisorModel(undefined);
		setAdvisorEffort(undefined);
		ensureToolActive(pi, false);
		if (ctx.hasUI) {
			ctx.ui.notify(errModelUnavailable(entry.modelStub), "warning");
		}
		return;
	}

	const newStub = `${model.provider}:${model.id}`;
	const unchanged = previousAdvisorStub === newStub && previousEffort === entry.effort;

	setAdvisorModel(model);
	setAdvisorEffort(entry.effort);
	ensureToolActive(pi, true);

	if (unchanged) return;

	if (ctx.hasUI) {
		if (reason === "restore") {
			ctx.ui.notify(msgAdvisorRestored(newStub, entry.effort, executorStub), "info");
		} else {
			ctx.ui.notify(msgAdvisorSwapped(newStub, entry.effort, executorStub ?? "unknown"), "info");
		}
	}
}

/** Backwards-compatible entry point retained for the session_start handler in index.ts. */
export function restoreAdvisorState(ctx: ExtensionContext, pi: ExtensionAPI): void {
	applyAdvisorForExecutor(ctx.model, ctx, pi, "restore");
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
		const response = await completeSimple(
			advisor,
			// `tools: []` reaffirms the "never calls tools" contract even when
			// `messages` contains prior toolCall/toolResult blocks (btw.ts:235).
			{ systemPrompt: ADVISOR_SYSTEM_PROMPT, messages, tools: [] },
			{ apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort },
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

// ---------------------------------------------------------------------------
// Tool registration — zero-param schema, curated description/snippet/guidelines
// ---------------------------------------------------------------------------

const AdvisorParams = Type.Object({
	stage: Type.Optional(
		Type.Union([Type.Literal("initial"), Type.Literal("recovery"), Type.Literal("final-check")]),
	),
});

const ADVISOR_DESCRIPTION =
	"Escalate to a stronger reviewer model for guidance. When you need " +
	"stronger judgment — a complex decision, an ambiguous failure, a problem " +
	"you're circling without progress — escalate to the advisor model for " +
	"guidance, then resume. Optional stage parameter: 'initial' (still exploring), " +
	"'recovery' (stuck or after failure), 'final-check' (implementation done, before declaring complete). " +
	"When stage is omitted it is auto-detected from recent tool activity. " +
	"Your full conversation history is automatically forwarded. " +
	"The advisor sees the task, every tool call you've made, every result you've seen.";

export const DEFAULT_PROMPT_SNIPPET =
	"Escalate to a stronger reviewer model for guidance. Optional stage: 'initial' | 'recovery' | 'final-check' (auto-detected when omitted)";

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Call `advisor` BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, fetching a source, seeing what's there) is not substantive work; writing, editing, and declaring an answer are.",
	"Also call `advisor` when you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change. The advisor call takes time; if the session ends during it, a durable result persists and an unwritten one doesn't.",
	"Also call `advisor` when stuck — errors recurring, approach not converging, results that don't fit — or when considering a change of approach.",
	"On tasks longer than a few steps, call `advisor` at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to keep calling — the advisor adds most of its value on the first call, before the approach crystallizes.",
	"Give the advisor's advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim, adapt — a passing self-test is not evidence the advice is wrong, it's evidence your test doesn't check what the advice is checking.",
	"If you've already retrieved data pointing one way and the advisor points another, don't silently switch — surface the conflict in one more `advisor` call (\"I found X, you suggest Y, which constraint breaks the tie?\"). A reconcile call is cheaper than committing to the wrong branch.",
	"Pass stage: 'initial' when still orienting, stage: 'recovery' when stuck or after a failure, stage: 'final-check' after implementing and verifying. Omit stage to let recent tool activity drive auto-detection.",
];

export function registerAdvisorTool(pi: ExtensionAPI): void {
	const guidance = validateGuidanceFields(loadAdvisorConfig().guidance);
	pi.registerTool({
		name: ADVISOR_TOOL_NAME,
		label: TOOL_LABEL,
		description: ADVISOR_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
		parameters: AdvisorParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			return executeAdvisor(ctx, pi, signal, onUpdate, params.stage);
		},
	});
}

// ---------------------------------------------------------------------------
// before_agent_start handler — strip advisor from active tools when disabled
// ---------------------------------------------------------------------------

export function registerAdvisorBeforeAgentStart(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async () => {
		if (!getAdvisorModel()) {
			const active = pi.getActiveTools();
			if (active.includes(ADVISOR_TOOL_NAME)) {
				pi.setActiveTools(active.filter((n) => n !== ADVISOR_TOOL_NAME));
			}
		}
	});
}

// ---------------------------------------------------------------------------
// /advisor slash command — mappings overview → model picker → effort picker
// ---------------------------------------------------------------------------

export function registerAdvisorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("advisor", {
		description: "Configure per-executor advisor model pairings",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(MSG_REQUIRES_INTERACTIVE, "error");
				return;
			}

			const availableModels = ctx.modelRegistry.getAvailable();
			const config = loadAdvisorConfig();
			const executorStubActive = modelStubOf(ctx.model);

			// Helper: human-readable label for an advisor entry.
			function advisorLabel(entry: { modelStub?: string; effort?: ThinkingLevel } | undefined): string {
				if (!entry?.modelStub) return "—";
				const parsed = parseModelStub(entry.modelStub);
				const model = parsed
					? availableModels.find((m) => m.provider === parsed.provider && m.id === parsed.modelId)
					: undefined;
				const name = model?.name ?? entry.modelStub;
				return `${name}${entry.effort ? ` / ${entry.effort}` : ""}`;
			}

			// --- Step 1: Mappings overview ---
			const mappingItems: SelectItem[] = availableModels.map((m) => {
				const stub = `${m.provider}:${m.id}`;
				const isActive = stub === executorStubActive;
				const entry = config.byExecutor?.[stub];
				return {
					value: stub,
					label: `${m.name}  (${m.provider})${isActive ? CHECKMARK : ""}    \u2192  ${advisorLabel(entry)}`,
				};
			});
			mappingItems.push({
				value: DEFAULT_EXECUTOR_VALUE,
				label: `[default fallback]    \u2192  ${advisorLabel(config.default)}`,
			});

			const initialIdx = mappingItems.findIndex((item) => item.value === executorStubActive);
			const executorChoice = await showMappingsPicker(ctx, mappingItems, initialIdx >= 0 ? initialIdx : undefined);
			if (!executorChoice) return;

			// executorStub: undefined means "default", string means a specific executor
			const executorStub = executorChoice === DEFAULT_EXECUTOR_VALUE ? undefined : executorChoice;

			// The active session's in-memory advisor needs updating when:
			// - configuring the active executor directly, OR
			// - configuring default AND active executor has no specific byExecutor entry
			const executorIsActive =
				executorStub === executorStubActive ||
				(executorStub === undefined && !config.byExecutor?.[executorStubActive ?? ""]?.modelStub);

			// --- Step 2: Advisor model picker ---
			const currentEntry = executorStub ? config.byExecutor?.[executorStub] : config.default;
			const currentAdvisorStub = currentEntry?.modelStub;
			const currentAdvisorEffort = currentEntry?.effort;

			const items: SelectItem[] = availableModels.map((m) => {
				const stub = `${m.provider}:${m.id}`;
				const check = stub === currentAdvisorStub ? CHECKMARK : "";
				return { value: stub, label: `${m.name}  (${m.provider})${check}` };
			});
			items.push({
				value: NO_ADVISOR_VALUE,
				label: currentAdvisorStub === undefined ? `No advisor${CHECKMARK}` : "No advisor",
			});

			const choice = await showAdvisorPicker(ctx, items);
			if (!choice) return;

			if (choice === NO_ADVISOR_VALUE) {
				saveAdvisorConfig(undefined, undefined, executorStub);
				if (executorIsActive) {
					setAdvisorModel(undefined);
					setAdvisorEffort(undefined);
					getAdvisorRuntimeState().activeExecutorKey = executorStubActive;
					ensureToolActive(pi, false);
					ctx.ui.notify(MSG_ADVISOR_DISABLED, "info");
				} else {
					ctx.ui.notify(msgClearedForExecutor(executorStub!), "info");
				}
				return;
			}

			const picked = availableModels.find((m) => `${m.provider}:${m.id}` === choice);
			if (!picked) {
				ctx.ui.notify(errSelectionNotFound(choice), "error");
				return;
			}

			// --- Step 3: Effort picker ---
			let effortChoice: ThinkingLevel | undefined;
			if (picked.reasoning) {
				const levels = getSupportedThinkingLevels(picked).includes("xhigh")
					? [...BASE_EFFORT_LEVELS, XHIGH_EFFORT_LEVEL]
					: BASE_EFFORT_LEVELS;

				const effortItems: SelectItem[] = [
					{ value: OFF_VALUE, label: "off" },
					...levels.map((level) => ({
						value: level,
						label: level === DEFAULT_EFFORT ? `${level}${RECOMMENDED_EFFORT_SUFFIX}` : level,
					})),
				];

				const effortResult = await showEffortPicker(ctx, effortItems, currentAdvisorEffort, DEFAULT_EFFORT);
				if (!effortResult) return;
				effortChoice = effortResult === OFF_VALUE ? undefined : (effortResult as ThinkingLevel);
			}

			const pickedStub = `${picked.provider}:${picked.id}`;
			saveAdvisorConfig(pickedStub, effortChoice, executorStub);

			if (executorIsActive) {
				setAdvisorModel(picked);
				setAdvisorEffort(effortChoice);
				getAdvisorRuntimeState().activeExecutorKey = executorStubActive;
				ensureToolActive(pi, true);
				ctx.ui.notify(msgAdvisorEnabled(pickedStub, effortChoice, executorStub ?? "default"), "info");
			} else {
				ctx.ui.notify(msgSavedForExecutor(executorStub!, pickedStub, effortChoice), "info");
			}
		},
	});
}
