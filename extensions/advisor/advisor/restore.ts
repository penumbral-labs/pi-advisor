/** Restore and reconcile the advisor selected for an executor model. */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadAdvisorConfig, modelStubOf, parseModelStub, resolveAdvisorEntry } from "./config.js";
import { reconcileAdvisorTool } from "./handlers.js";
import {
	errModelUnavailable,
	MSG_NO_ADVISOR_FOR_EXECUTOR,
	msgAdvisorRestored,
	msgAdvisorSwapped,
} from "./messages.js";
import {
	getActiveExecutorKey,
	getAdvisorEffort,
	getAdvisorModel,
	setActiveExecutorKey,
	setAdvisorEffort,
	setAdvisorModel,
} from "./state.js";

export type ReconcileReason = "restore" | "swap";

function clearAdvisor(pi: ExtensionAPI): void {
	setAdvisorModel(undefined);
	setAdvisorEffort(undefined);
	reconcileAdvisorTool(pi, false);
}

function findMappedModel(ctx: ExtensionContext, modelStub: string): Model<Api> | undefined {
	const parsed = parseModelStub(modelStub);
	return parsed ? ctx.modelRegistry.find(parsed.provider, parsed.modelId) : undefined;
}

export function applyAdvisorForExecutor(
	executor: Model<Api> | undefined,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	reason: ReconcileReason,
): void {
	const executorStub = modelStubOf(executor);
	const entry = resolveAdvisorEntry(loadAdvisorConfig(), executorStub);
	const previousExecutor = getActiveExecutorKey();
	const previousModel = getAdvisorModel();
	const previousStub = modelStubOf(previousModel);
	const previousEffort = getAdvisorEffort();
	setActiveExecutorKey(executorStub);

	if (!entry?.modelStub) {
		clearAdvisor(pi);
		if (reason === "swap" && previousModel && previousExecutor !== executorStub && ctx.hasUI) {
			ctx.ui.notify(MSG_NO_ADVISOR_FOR_EXECUTOR, "info");
		}
		return;
	}

	const model = findMappedModel(ctx, entry.modelStub);
	if (!model) {
		clearAdvisor(pi);
		if (ctx.hasUI && (reason !== "restore" || previousStub !== undefined || previousExecutor !== executorStub)) {
			ctx.ui.notify(errModelUnavailable(entry.modelStub), "warning");
		}
		return;
	}

	const advisorStub = modelStubOf(model)!;
	const unchanged = previousStub === advisorStub && previousEffort === entry.effort;
	setAdvisorModel(model);
	setAdvisorEffort(entry.effort);
	reconcileAdvisorTool(pi, true);
	if (unchanged || !ctx.hasUI) return;
	ctx.ui.notify(
		reason === "restore"
			? msgAdvisorRestored(advisorStub, entry.effort, executorStub)
			: msgAdvisorSwapped(advisorStub, entry.effort, executorStub ?? "unknown"),
		"info",
	);
}

export function restoreAdvisorState(ctx: ExtensionContext, pi: ExtensionAPI): void {
	applyAdvisorForExecutor(ctx.model, ctx, pi, "restore");
}

export function registerAdvisorSessionStart(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => restoreAdvisorState(ctx, pi));
}
