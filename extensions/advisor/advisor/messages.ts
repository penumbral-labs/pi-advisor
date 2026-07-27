/** Shared advisor vocabulary and user-facing messages. */

import type { ThinkingLevel } from "@earendil-works/pi-ai";

export const ADVISOR_TOOL_NAME = "advisor";
export const TOOL_LABEL = "Advisor";

export const NO_ADVISOR_VALUE = "__no_advisor__";
export const OFF_VALUE = "__off__";
export const DEFAULT_EXECUTOR_VALUE = "__default__";
export const NUDGE_DEFAULT_VALUE = "__nudge_default__";

export const BASE_EFFORT_LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high"];
export const XHIGH_EFFORT_LEVEL: ThinkingLevel = "xhigh";
export const DEFAULT_EFFORT: ThinkingLevel = "high";
export const RECOMMENDED_EFFORT_SUFFIX = "  (recommended)";
export const CHECKMARK = " ✓";

export const MSG_ADVISOR_DISABLED = "Advisor disabled";
export const MSG_CONFIG_SAVE_FAILED = "Advisor config could not be saved; selection was not changed.";
export const MSG_NO_ADVISOR_FOR_EXECUTOR = "No advisor configured for this executor; advisor disabled.";
export const MSG_REQUIRES_INTERACTIVE = "/advisor requires interactive mode";
export const MSG_ADVISOR_NUDGE = "Please advise on the executor's situation above.";

export const ERR_NO_MODEL = "No advisor model is configured. The user can enable one with the /advisor command.";
export const ERR_CALL_ABORTED = "Advisor call was cancelled before it completed.";
export const ERR_EMPTY_RESPONSE = "Advisor returned no text content.";
export const ERR_NO_MODEL_SELECTED = "no advisor model selected";
export const ERR_EMPTY_RESPONSE_DETAIL = "empty response";
export const ERR_ABORTED_DETAIL = "aborted";
export const ERR_UNKNOWN = "unknown error";

export const errMisconfigured = (label: string, err: string) => `Advisor (${label}) is misconfigured: ${err}`;
export const errNoApiKey = (label: string) => `Advisor (${label}) has no API key available.`;
export const errNoApiKeyDetail = (provider: string) => `no API key for ${provider}`;
export const errCallFailed = (err: string | undefined) => `Advisor call failed: ${err ?? ERR_UNKNOWN}`;
export const errCallThrew = (msg: string) => `Advisor call threw: ${msg}`;
export const errSelectionNotFound = (choice: string) => `Advisor selection not found: ${choice}`;
export const errModelUnavailable = (key: string) => `Previously configured advisor model ${key} is no longer available`;
export const msgAdvisorEnabled = (label: string, effort: ThinkingLevel | undefined, executorKey?: string) =>
	`Advisor: ${label}${effort ? `, ${effort}` : ""}${executorKey ? ` (for ${executorKey})` : ""}`;
export const msgAdvisorRestored = (label: string, effort: ThinkingLevel | undefined, executorKey?: string) =>
	`Advisor restored: ${label}${effort ? `, ${effort}` : ""}${executorKey ? ` (for ${executorKey})` : ""}`;
export const msgAdvisorSwapped = (label: string, effort: ThinkingLevel | undefined, executorKey: string) =>
	`Advisor swapped to ${label}${effort ? `, ${effort}` : ""} (executor: ${executorKey})`;
export const msgSavedForExecutor = (executorStub: string, advisorStub: string, effort: ThinkingLevel | undefined) =>
	`Saved for ${executorStub}: ${advisorStub}${effort ? ` / ${effort}` : ""}`;
export const msgClearedForExecutor = (executorStub: string) => `Advisor cleared for ${executorStub}`;
export const msgConsulting = (label: string, effort: ThinkingLevel | undefined) =>
	`Consulting advisor (${label}${effort ? `, ${effort}` : ""})…`;
