/**
 * Local advisor config at ~/.pi/agent/pi-advisor.json.
 *
 * This module owns the fork's persisted schema, colon-delimited model codec,
 * guidance validation, per-executor resolution, and JSON I/O.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { NudgeConfig } from "./nudges.js";

export const ADVISOR_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-advisor.json");
let advisorConfigPath = ADVISOR_CONFIG_PATH;
const advisorConfigInvalidators = new Set<() => void>();

export function onAdvisorConfigSaved(invalidate: () => void): () => void {
	advisorConfigInvalidators.add(invalidate);
	return () => { advisorConfigInvalidators.delete(invalidate); };
}

/** @internal Override the config file for isolated tests; returns a restore function. */
export function __setAdvisorConfigPathForTests(path: string): () => void {
	const previousPath = advisorConfigPath;
	advisorConfigPath = path;
	return () => { advisorConfigPath = previousPath; };
}

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export interface AdvisorEntry {
	modelStub?: string;
	effort?: ThinkingLevel;
	/** Per-executor nudge thresholds, merged over the global nudge config. */
	nudge?: NudgeConfig;
}

export interface AdvisorConfig {
	/** Default advisor when no per-executor entry matches. */
	default?: AdvisorEntry;
	/** Per-executor advisor mapping, indexed by a `<provider>:<modelId>` stub. */
	byExecutor?: Record<string, AdvisorEntry>;
	guidance?: GuidanceFields;
	maxUsesPerRun?: number;
	maxContextMessages?: number;
	nudge?: NudgeConfig;
	quietPaths?: string[];
	/** Preserve fields added by hand or by later package versions. */
	[key: string]: unknown;
}

/** Load a JSON object, returning an empty config for missing or invalid files. */
export function loadJsonConfig<T extends object = AdvisorConfig>(path: string): T {
	if (!existsSync(path)) return {} as T;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
		return parsed as T;
	} catch {
		console.warn(`pi-advisor: invalid JSON at ${path}; using empty config`);
		return {} as T;
	}
}

export function loadAdvisorConfig(): AdvisorConfig {
	return loadJsonConfig<AdvisorConfig>(advisorConfigPath);
}

/** Persist formatted JSON atomically. The default umask controls permissions. */
export function saveJsonConfig(path: string, config: object): boolean {
	const tempPath = join(dirname(path), `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		renameSync(tempPath, path);
		return true;
	} catch {
		try { rmSync(tempPath, { force: true }); } catch {}
		return false;
	}
}

export function writeAdvisorConfig(config: AdvisorConfig): boolean {
	const saved = saveJsonConfig(advisorConfigPath, config);
	if (saved) for (const invalidate of advisorConfigInvalidators) invalidate();
	return saved;
}

/** Resolve a specific executor mapping first, then fall back to the default. */
export function resolveAdvisorEntry(config: AdvisorConfig, executorStub: string | undefined): AdvisorEntry | undefined {
	if (executorStub) {
		const specific = config.byExecutor?.[executorStub];
		if (specific?.modelStub) return specific;
	}
	if (config.default?.modelStub) return config.default;
	return undefined;
}

export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return {};
	const candidate = fields as Record<string, unknown>;
	const guidance: GuidanceFields = {};
	if (typeof candidate.promptSnippet === "string" && candidate.promptSnippet.length > 0) {
		guidance.promptSnippet = candidate.promptSnippet;
	}
	if (
		Array.isArray(candidate.promptGuidelines) &&
		candidate.promptGuidelines.length > 0 &&
		candidate.promptGuidelines.every((value) => typeof value === "string" && value.length > 0)
	) {
		guidance.promptGuidelines = candidate.promptGuidelines as string[];
	}
	return guidance;
}

/** Return a config with one advisor selection changed, preserving all other fields. */
export function updateAdvisorConfig(
	existing: AdvisorConfig,
	stub: string | undefined,
	effort: ThinkingLevel | undefined,
	executorStub: string | undefined,
	nudge?: NudgeConfig,
): AdvisorConfig {
	const config: AdvisorConfig = {
		...existing,
		byExecutor: { ...(existing.byExecutor ?? {}) },
	};

	const buildEntry = (modelStub: string, previous?: AdvisorEntry): AdvisorEntry => {
		const entry: AdvisorEntry = { ...previous, modelStub };
		if (effort) entry.effort = effort;
		else delete entry.effort;
		if (nudge) entry.nudge = nudge;
		else delete entry.nudge;
		return entry;
	};

	if (executorStub) {
		if (stub) {
			config.byExecutor![executorStub] = buildEntry(stub, config.byExecutor![executorStub]);
			if (!config.default?.modelStub) config.default = buildEntry(stub);
		} else {
			delete config.byExecutor![executorStub];
		}
	} else if (stub) {
		config.default = buildEntry(stub, config.default);
	} else {
		delete config.default;
	}

	if (config.byExecutor && Object.keys(config.byExecutor).length === 0) delete config.byExecutor;
	return config;
}

/** Persist an advisor selection and report whether the write succeeded. */
export function saveAdvisorConfig(
	stub: string | undefined,
	effort: ThinkingLevel | undefined,
	executorStub: string | undefined,
	nudge?: NudgeConfig,
): boolean {
	return writeAdvisorConfig(updateAdvisorConfig(loadAdvisorConfig(), stub, effort, executorStub, nudge));
}

export function parseModelStub(stub: string): { provider: string; modelId: string } | undefined {
	const separator = stub.indexOf(":");
	if (separator < 1 || separator === stub.length - 1) return undefined;
	return { provider: stub.slice(0, separator), modelId: stub.slice(separator + 1) };
}

export function modelStubOf(model: { provider: string; id: string } | undefined): string | undefined {
	if (!model) return undefined;
	return `${model.provider}:${model.id}`;
}
