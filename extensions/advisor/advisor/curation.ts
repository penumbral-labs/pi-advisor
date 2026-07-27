/** Bounded curation of Pi's canonical LLM context for advisor requests. */

import type { Message } from "@earendil-works/pi-ai";
import { buildAdvisorMessages, type ExecutorSignals } from "../advisor-messages.js";
import type { AdvisorStage } from "./execution-context.js";

export function curateAdvisorMessages(
	messages: Message[],
	stageInfo: { stage: AdvisorStage; reason: string },
	recentToolActivity: string,
	maxMessages: number,
	signals: ExecutorSignals,
): Message[] {
	return buildAdvisorMessages(
		messages as unknown as Parameters<typeof buildAdvisorMessages>[0],
		stageInfo,
		recentToolActivity,
		maxMessages,
		signals,
	) as unknown as Message[];
}
