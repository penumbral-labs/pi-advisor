/**
 * @penumbral-labs/pi-advisor — Pi extension
 *
 * Forked from @juicesharp/rpiv-advisor. Adds per-executor advisor mapping:
 * a different advisor (and reasoning effort) can be configured for each
 * primary/executor model. The mapping lives in `~/.pi/agent/pi-advisor.json`
 * (colocated with other pi-plugin config).
 *
 * Lifecycle:
 *   - session_start  → resolve and apply the advisor for the current executor
 *   - model_select   → re-resolve when the user changes executor mid-session
 *   - before_agent_start → strip the advisor tool when no advisor is active
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ADVISOR_TOOL_NAME,
	applyAdvisorForExecutor,
	getAdvisorModel,
	getRunToolEvents,
	getUsesThisRun,
	loadAdvisorConfig,
	MAX_USES_PER_RUN_DEFAULT,
	pushRunToolEvent,
	registerAdvisorBeforeAgentStart,
	registerAdvisorCommand,
	registerAdvisorTool,
	resetRunState,
	summarizeToolExecution,
} from "./advisor.js";
import { shouldNudge } from "./advisor-messages.js";

export default function (pi: ExtensionAPI) {
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
	registerAdvisorBeforeAgentStart(pi);

	const toolArgsById = new Map<string, unknown>();

	pi.on("agent_start", async (_event, ctx) => {
		resetRunState();
		toolArgsById.clear();
		ctx.ui.setStatus("advisor-nudge", undefined);
	});

	pi.on("tool_execution_start", async (event) => {
		toolArgsById.set(event.toolCallId, event.args);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (event.toolName === ADVISOR_TOOL_NAME) return;
		const args = toolArgsById.get(event.toolCallId);
		toolArgsById.delete(event.toolCallId);
		pushRunToolEvent(summarizeToolExecution(event.toolName, args, event.result, event.isError));
		const config = loadAdvisorConfig();
		const maxUsesPerRun = config.maxUsesPerRun ?? MAX_USES_PER_RUN_DEFAULT;
		const hint = shouldNudge(getRunToolEvents(), getUsesThisRun(), getAdvisorModel() !== undefined, maxUsesPerRun);
		ctx.ui.setStatus("advisor-nudge", hint ?? undefined);
	});

	pi.on("session_start", async (_event, ctx) => {
		applyAdvisorForExecutor(ctx.model, ctx, pi, "restore");
	});

	pi.on("model_select", async (event, ctx) => {
		// Fires for every model change (set, cycle, restore). The applier
		// no-ops when the resolved advisor hasn't actually changed, so
		// re-runs from the "restore" source on session boot are harmless.
		applyAdvisorForExecutor(event.model, ctx, pi, event.source === "restore" ? "restore" : "swap");
	});
}
