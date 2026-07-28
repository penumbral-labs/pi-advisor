/** Stable executor-tool inventory for advisor prompt cache parity. */

import type { Message } from "@earendil-works/pi-ai";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

const INVENTORY_STATE_KEY = Symbol.for("penumbral-pi-advisor-inventory");
interface InventoryState { signature?: string; message?: Message; }

function state(): InventoryState {
	const root = globalThis as unknown as { [INVENTORY_STATE_KEY]?: InventoryState };
	return root[INVENTORY_STATE_KEY] ??= {};
}

export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : stableStringify(item)).join(",")}]`;
	const entries = Object.keys(value).sort().flatMap((key) => {
		const item = (value as Record<string, unknown>)[key];
		return item === undefined ? [] : [`${JSON.stringify(key)}:${stableStringify(item)}`];
	});
	return `{${entries.join(",")}}`;
}

export function getInventoryMessage(tools: ToolInfo[]): Message | undefined {
	if (tools.length === 0) return undefined;
	const sorted = [...tools].sort((left, right) => left.name.localeCompare(right.name));
	const signature = sorted.map((tool) => tool.name).join("|");
	const cache = state();
	if (cache.signature === signature && cache.message) return cache.message;
	const body = sorted.map((tool) =>
		`### ${tool.name}\n${tool.description}\n\nParameters: ${stableStringify(tool.parameters)}`,
	).join("\n\n---\n\n");
	cache.signature = signature;
	cache.message = {
		role: "user",
		content: [{ type: "text", text: `## Available Executor Tools\n\n${body}` }],
		timestamp: Date.now(),
	};
	return cache.message;
}
