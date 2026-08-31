/** Per-executor /advisor mapping command. */

import { getSupportedThinkingLevels, type Api, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SelectItem } from "@earendil-works/pi-tui";
import { showAdvisorPicker, showEffortPicker, showMappingsPicker, showNudgePicker } from "../advisor-ui.js";
import {
	isAdvisorEffortSupported, loadAdvisorConfig, modelStubOf, parseModelStub, saveAdvisorConfig, type AdvisorEntry,
} from "./config.js";
import {
	CHECKMARK, DEFAULT_EFFORT, DEFAULT_EXECUTOR_VALUE, EFFORT_LEVELS, errSelectionNotFound,
	MSG_ADVISOR_DISABLED, MSG_CONFIG_SAVE_FAILED, MSG_DEFAULT_CLEARED, MSG_EFFORT_NOT_SET, MSG_REQUIRES_INTERACTIVE,
	msgAdvisorEnabled, msgClearedForExecutor, msgSavedForDefault, msgSavedForExecutor, NO_ADVISOR_VALUE,
	NUDGE_DEFAULT_VALUE, OFF_VALUE, RECOMMENDED_EFFORT_SUFFIX,
} from "./messages.js";
import { reconcileAdvisorTool } from "./handlers.js";
import { detectExactNudgePreset, NUDGE_PRESETS, type NudgePreset } from "./nudges.js";
import { applyAdvisorForExecutor } from "./restore.js";
import { setActiveExecutorKey, setAdvisorEffort, setAdvisorModel } from "./state.js";

export function buildEffortItems(model: Parameters<typeof getSupportedThinkingLevels>[0]): SelectItem[] {
	const levels = getSupportedThinkingLevels(model).filter((level): level is ThinkingLevel =>
		EFFORT_LEVELS.includes(level as ThinkingLevel),
	);
	return [
		{ value: OFF_VALUE, label: "off (no reasoning sent)" },
		...levels.map((level) => ({
			value: level,
			label: level === DEFAULT_EFFORT ? `${level}${RECOMMENDED_EFFORT_SUFFIX}` : level,
		})),
	];
}

function nudgeLabel(nudge: AdvisorEntry["nudge"]): string {
	const preset = detectExactNudgePreset(nudge);
	return preset === "default" ? "" : `  [nudge:${preset}]`;
}

export function formatEntryLabel(entry: AdvisorEntry | undefined, available: Model<Api>[]): string {
	if (!entry?.modelStub) return "—";
	const parsed = parseModelStub(entry.modelStub);
	const found = parsed ? available.find((model) => model.provider === parsed.provider && model.id === parsed.modelId) : undefined;
	if (!found) return `${entry.modelStub}${entry.effort ? ` / ${entry.effort}` : ""}${nudgeLabel(entry.nudge)}`;
	const supportedEffort = isAdvisorEffortSupported(entry.effort, getSupportedThinkingLevels(found))
		? entry.effort
		: undefined;
	const effortLabel = supportedEffort
		? ` / ${supportedEffort}`
		: entry.effort ? ` / ${entry.effort} (unsupported)` : "";
	return `${found.name}${effortLabel}${nudgeLabel(entry.nudge)}`;
}

export function registerAdvisorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("advisor", {
		description: "Configure per-executor advisor model pairings",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) { ctx.ui.notify(MSG_REQUIRES_INTERACTIVE, "error"); return; }
			const available = ctx.modelRegistry.getAvailable();
			const config = loadAdvisorConfig();
			const activeExecutor = modelStubOf(ctx.model);

			const mappings: SelectItem[] = available.map((model) => {
				const stub = modelStubOf(model)!;
				return { value: stub, label: `${model.name}  (${model.provider})${stub === activeExecutor ? CHECKMARK : ""}    →  ${formatEntryLabel(config.byExecutor?.[stub], available)}` };
			});
			mappings.push({ value: DEFAULT_EXECUTOR_VALUE, label: `[default fallback]    →  ${formatEntryLabel(config.default, available)}` });
			const initial = mappings.findIndex((item) => item.value === activeExecutor);
			const executorChoice = await showMappingsPicker(ctx, mappings, initial >= 0 ? initial : undefined);
			if (!executorChoice) return;
			const executorStub = executorChoice === DEFAULT_EXECUTOR_VALUE ? undefined : executorChoice;
			const affectsActive = executorStub === activeExecutor || (executorStub === undefined && !config.byExecutor?.[activeExecutor ?? ""]?.modelStub);
			const current = executorStub ? config.byExecutor?.[executorStub] : config.default;

			const models: SelectItem[] = available.map((model) => {
				const stub = modelStubOf(model)!;
				return { value: stub, label: `${model.name}  (${model.provider})${stub === current?.modelStub ? CHECKMARK : ""}` };
			});
			models.push({ value: NO_ADVISOR_VALUE, label: current?.modelStub ? "No advisor" : `No advisor${CHECKMARK}` });
			const choice = await showAdvisorPicker(ctx, models);
			if (!choice) return;
			if (choice === NO_ADVISOR_VALUE) {
				if (!saveAdvisorConfig(undefined, undefined, executorStub)) { ctx.ui.notify(MSG_CONFIG_SAVE_FAILED, "error"); return; }
				if (affectsActive) {
					if (executorStub && config.default?.modelStub) {
						applyAdvisorForExecutor(ctx.model, ctx, pi, "swap");
					} else {
						setAdvisorModel(undefined); setAdvisorEffort(undefined); setActiveExecutorKey(activeExecutor);
						reconcileAdvisorTool(pi, false); ctx.ui.notify(MSG_ADVISOR_DISABLED, "info");
					}
				} else ctx.ui.notify(executorStub ? msgClearedForExecutor(executorStub) : MSG_DEFAULT_CLEARED, "info");
				return;
			}

			const picked = available.find((model) => modelStubOf(model) === choice);
			if (!picked) { ctx.ui.notify(errSelectionNotFound(choice), "error"); return; }
			let effort: ThinkingLevel | undefined;
			if (picked.reasoning) {
				const selected = await showEffortPicker(ctx, buildEffortItems(picked), current?.effort, DEFAULT_EFFORT);
				if (!selected) ctx.ui.notify(MSG_EFFORT_NOT_SET, "info");
				else effort = selected === OFF_VALUE ? undefined : selected as ThinkingLevel;
			}

			const preset = detectExactNudgePreset(current?.nudge);
			const nudgeValues = ["heavy", NUDGE_DEFAULT_VALUE, "light", "off"];
			const nudgeItems = [
				{ value: "heavy", label: `heavy  (nudge early and often)${preset === "heavy" ? CHECKMARK : ""}` },
				{ value: NUDGE_DEFAULT_VALUE, label: `default  (balanced)${preset === "default" ? CHECKMARK : ""}` },
				{ value: "light", label: `light  (nudge infrequently)${preset === "light" ? CHECKMARK : ""}` },
				{ value: "off", label: `off  (no automatic nudges)${preset === "off" ? CHECKMARK : ""}` },
			];
			const presetIndex = preset === "custom" ? undefined : nudgeValues.indexOf(preset === "default" ? NUDGE_DEFAULT_VALUE : preset);
			const selectedNudge = await showNudgePicker(ctx, nudgeItems, presetIndex);
			const presetChoice: NudgePreset = !selectedNudge || selectedNudge === NUDGE_DEFAULT_VALUE
				? "default"
				: selectedNudge as NudgePreset;
			const nudge = selectedNudge ? NUDGE_PRESETS[presetChoice] : current?.nudge;
			const pickedStub = modelStubOf(picked)!;
			if (!saveAdvisorConfig(pickedStub, effort, executorStub, nudge)) { ctx.ui.notify(MSG_CONFIG_SAVE_FAILED, "error"); return; }
			if (affectsActive) {
				setAdvisorModel(picked); setAdvisorEffort(effort); setActiveExecutorKey(activeExecutor); reconcileAdvisorTool(pi, true);
				ctx.ui.notify(msgAdvisorEnabled(pickedStub, effort, executorStub ?? "default"), "info");
			} else ctx.ui.notify(executorStub ? msgSavedForExecutor(executorStub, pickedStub, effort) : msgSavedForDefault(pickedStub, effort), "info");
		},
	});
}
