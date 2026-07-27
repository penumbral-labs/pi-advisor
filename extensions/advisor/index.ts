/** @penumbral-labs/pi-advisor extension entrypoint. */

import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ADVISOR_TOOL_NAME,
	getActiveExecutorKey,
	getAdvisorModel,
	getNudgedThisRun,
	getRunToolEvents,
	getSessionLastNudgeAtCount,
	getSessionToolCallCount,
	getUsesThisRun,
	incrementSessionToolCallCount,
	loadAdvisorConfig,
	MAX_USES_PER_RUN_DEFAULT,
	pushRunToolEvent,
	resetRunState,
	resetSessionNudgeState,
	resolveNudgeConfig,
	setNudgedThisRun,
	setSessionLastNudgeAtCount,
	summarizeToolExecution,
} from "./advisor.js";
import {
	registerAdvisorBeforeAgentStart,
	registerAdvisorCommand,
	registerAdvisorSessionStart,
	registerAdvisorTool,
	registerModelSelectHandler,
} from "./advisor/index.js";
import { cwdMatchesQuietPath, shouldNudge } from "./advisor-messages.js";

export default function advisorExtension(pi: ExtensionAPI) {
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
	registerAdvisorBeforeAgentStart(pi);
	registerModelSelectHandler(pi);

	const toolArgsById = new Map<string, unknown>();
	pi.on("agent_start", async (_event, ctx) => {
		resetRunState(); toolArgsById.clear(); ctx.ui.setStatus("advisor-nudge", undefined);
	});
	pi.on("tool_execution_start", async (event) => { toolArgsById.set(event.toolCallId, event.args); });
	pi.on("tool_execution_end", async (event, ctx) => {
		if (event.toolName === ADVISOR_TOOL_NAME) return;
		const args = toolArgsById.get(event.toolCallId); toolArgsById.delete(event.toolCallId);
		pushRunToolEvent(summarizeToolExecution(event.toolName, args, event.result, event.isError));
		incrementSessionToolCallCount();
		const config = loadAdvisorConfig();
		if (cwdMatchesQuietPath(ctx.cwd, config.quietPaths, homedir())) {
			if (getNudgedThisRun()) ctx.ui.setStatus("advisor-nudge", undefined);
			return;
		}
		const nudge = resolveNudgeConfig(config, getActiveExecutorKey());
		const count = getSessionToolCallCount();
		const last = getSessionLastNudgeAtCount();
		if (last !== undefined && count - last < nudge.backoffToolCalls) {
			if (getNudgedThisRun()) ctx.ui.setStatus("advisor-nudge", undefined);
			return;
		}
		const hint = shouldNudge(getRunToolEvents(), getUsesThisRun(), getAdvisorModel() !== undefined, config.maxUsesPerRun ?? MAX_USES_PER_RUN_DEFAULT, nudge);
		if (hint && !getNudgedThisRun()) {
			setNudgedThisRun(true); setSessionLastNudgeAtCount(count);
			pi.sendMessage({ customType: "advisor-nudge", content: hint, display: true }, { deliverAs: "followUp" });
			ctx.ui.setStatus("advisor-nudge", "advisor nudged ↗");
		} else if (getNudgedThisRun()) ctx.ui.setStatus("advisor-nudge", undefined);
	});
	pi.on("session_start", async () => resetSessionNudgeState());
	registerAdvisorSessionStart(pi);
}
