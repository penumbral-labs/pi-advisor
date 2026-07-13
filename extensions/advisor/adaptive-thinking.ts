import type { Api, Model } from "@earendil-works/pi-ai";

// Cortex LiteLLM <1.89 translates reasoning_effort to legacy thinking.type=enabled,
// which Opus 4.8 and Sonnet 5 reject. Advisor calls completeSimple() directly and
// therefore bypass Pi's before_provider_request hooks.
const LITELLM_ADAPTIVE_THINKING_MODELS = new Set(["claude-opus-4-8", "claude-sonnet-5"]);
const LITELLM_ADAPTIVE_THINKING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function normalizeLiteLLMAdaptiveThinkingPayload(payload: unknown, model: Model<Api>): unknown | undefined {
	if (model.provider !== "litellm" || !LITELLM_ADAPTIVE_THINKING_MODELS.has(model.id)) return undefined;
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;

	const record = payload as Record<string, unknown>;
	if (typeof record.reasoning_effort !== "string") return undefined;

	const requestedEffort = record.reasoning_effort === "minimal" ? "low" : record.reasoning_effort;
	const effort = LITELLM_ADAPTIVE_THINKING_EFFORTS.has(requestedEffort) ? requestedEffort : "high";
	const outputConfig =
		typeof record.output_config === "object" && record.output_config !== null && !Array.isArray(record.output_config)
			? (record.output_config as Record<string, unknown>)
			: {};
	const normalized = { ...record };
	delete normalized.reasoning_effort;
	normalized.thinking = { type: "adaptive" };
	normalized.output_config = { ...outputConfig, effort };
	return normalized;
}
