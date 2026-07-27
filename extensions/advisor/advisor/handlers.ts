/** Per-executor lifecycle reconciliation handlers. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyAdvisorForExecutor } from "./restore.js";
import { ADVISOR_TOOL_NAME } from "./messages.js";
import { getAdvisorModel } from "./state.js";

export function reconcileAdvisorTool(pi: ExtensionAPI, active: boolean): void {
	const tools = pi.getActiveTools();
	const present = tools.includes(ADVISOR_TOOL_NAME);
	if (active && !present) pi.setActiveTools([...tools, ADVISOR_TOOL_NAME]);
	else if (!active && present) pi.setActiveTools(tools.filter((name) => name !== ADVISOR_TOOL_NAME));
}

export function registerAdvisorBeforeAgentStart(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async () => reconcileAdvisorTool(pi, getAdvisorModel() !== undefined));
}

export function registerModelSelectHandler(pi: ExtensionAPI): void {
	pi.on("model_select", async (event, ctx) => {
		applyAdvisorForExecutor(event.model, ctx, pi, event.source === "restore" ? "restore" : "swap");
	});
}

export function deactivateAdvisor(pi: ExtensionAPI, _ctx?: ExtensionContext): void {
	reconcileAdvisorTool(pi, false);
}
