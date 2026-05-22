/**
 * @penumbral-labs/pi-advisor — Pi extension
 *
 * Forked from @juicesharp/rpiv-advisor. Adds per-executor advisor mapping:
 * a different advisor (and reasoning effort) can be configured for each
 * primary/executor model. The mapping lives in `~/.pi/agent/pi-advisor.json`
 * (colocated with other pi-plugin config), with a one-time migration from
 * `~/.config/rpiv-advisor/advisor.json` (or interim
 * `~/.config/pi-advisor/advisor.json`) for existing users.
 *
 * Lifecycle:
 *   - session_start  → resolve and apply the advisor for the current executor
 *   - model_select   → re-resolve when the user changes executor mid-session
 *   - before_agent_start → strip the advisor tool when no advisor is active
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	applyAdvisorForExecutor,
	registerAdvisorBeforeAgentStart,
	registerAdvisorCommand,
	registerAdvisorTool,
} from "./advisor.js";

export default function (pi: ExtensionAPI) {
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
	registerAdvisorBeforeAgentStart(pi);

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
