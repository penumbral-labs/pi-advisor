/** Advisor tool registration. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeAdvisor } from "./execute.js";
import { DEFAULT_PROMPT_GUIDELINES, DEFAULT_PROMPT_SNIPPET } from "../guidance.js";
import { loadAdvisorConfig, validateGuidanceFields } from "./config.js";
import { ADVISOR_TOOL_NAME, TOOL_LABEL } from "./messages.js";

const AdvisorParams = Type.Object({
	stage: Type.Optional(Type.Union([
		Type.Literal("initial"), Type.Literal("recovery"), Type.Literal("final-check"),
	])),
});

const ADVISOR_DESCRIPTION =
	"Escalate to a stronger reviewer model when independent judgment could materially change the approach. " +
	"Optional stage: initial, recovery, or final-check; otherwise stage is inferred. " +
	"A bounded, curated view of the conversation and recent executor activity is forwarded automatically.";

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

export { DEFAULT_PROMPT_GUIDELINES, DEFAULT_PROMPT_SNIPPET };
