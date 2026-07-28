/** Stage inference and compact executor activity for advisor requests. */

export type AdvisorStage = "initial" | "recovery" | "final-check";

export type ExecutorSignals = {
	phase: "exploring" | "mutating" | "verifying" | "stuck";
	mutationsCount: number;
	verificationCommands: string[];
	recentFailures: string[];
};

export function isVerificationCommand(command?: string): boolean {
	if (!command) return false;
	return /\b(test|tests|jest|vitest|pytest|rspec|cargo test|go test|npm run test|npm test|pnpm test|pnpm run test|yarn test|check|lint|typecheck|tsc|build)\b/i.test(command);
}

export interface RunToolEvent {
	toolName: string;
	summary: string;
	command?: string;
	isError: boolean;
	timestamp: number;
}

const RECENT_TOOL_SUMMARY_COUNT = 8;
let runToolEvents: RunToolEvent[] = [];

export function getRunToolEvents(): RunToolEvent[] {
	return runToolEvents;
}

export function pushRunToolEvent(event: RunToolEvent): void {
	runToolEvents.push(event);
}

export function resetRunToolEvents(): void {
	runToolEvents = [];
}

function buildRecentToolActivity(events: RunToolEvent[]): string {
	return events
		.slice(-RECENT_TOOL_SUMMARY_COUNT)
		.map((event) => `- ${event.summary}`)
		.join("\n");
}

function findLatestVerification(events: RunToolEvent[]): RunToolEvent | undefined {
	return [...events].reverse().find((event) => event.toolName === "bash" && isVerificationCommand(event.command));
}

function buildExecutorSignals(events: RunToolEvent[]): ExecutorSignals {
	const mutationsCount = events.filter((event) => event.toolName === "edit" || event.toolName === "write").length;
	const verificationCommands = events
		.filter((event) => event.toolName === "bash" && isVerificationCommand(event.command))
		.map((event) => event.command!);
	const latestVerification = findLatestVerification(events);
	const recentFailures = events
		.filter((event) => event.isError)
		.slice(-3)
		.map((event) => event.summary);
	let phase: ExecutorSignals["phase"] = "exploring";
	if (latestVerification?.isError || (!latestVerification && recentFailures.length > 0)) phase = "stuck";
	else if (mutationsCount > 0 && latestVerification) phase = "verifying";
	else if (mutationsCount > 0) phase = "mutating";
	return { phase, mutationsCount, verificationCommands, recentFailures };
}

export function detectAdvisorStage(events: RunToolEvent[], advisorCallsThisRun: number): { stage: AdvisorStage; reason: string } {
	const hasMutation = events.some((event) => event.toolName === "edit" || event.toolName === "write");
	const latestVerification = findLatestVerification(events);
	const recentFailure = [...events].reverse().find((event) => event.isError);
	const explorationCount = events.filter((event) => event.toolName === "read" || event.toolName === "bash").length;
	if (latestVerification?.isError) return { stage: "recovery", reason: `Failed verification signal: ${latestVerification.summary}` };
	if (hasMutation && latestVerification) {
		return { stage: "final-check", reason: "Implementation changes exist and verification output is already in the transcript." };
	}
	if (recentFailure) return { stage: "recovery", reason: `Recent failure signal: ${recentFailure.summary}` };
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

export function buildExecutorContext(
	events: RunToolEvent[],
	advisorCallsThisRun: number,
	stageOverride?: AdvisorStage,
): { stageInfo: { stage: AdvisorStage; reason: string }; recentToolActivity: string; signals: ExecutorSignals } {
	return {
		stageInfo: stageOverride
			? { stage: stageOverride, reason: "Executor explicitly signaled this stage." }
			: detectAdvisorStage(events, advisorCallsThisRun),
		recentToolActivity: buildRecentToolActivity(events),
		signals: buildExecutorSignals(events),
	};
}
