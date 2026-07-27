import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const runtimeStubs = new Map([
	["@earendil-works/pi-ai", new URL("./runtime-stubs/pi-ai.mjs", import.meta.url).href],
	["@earendil-works/pi-coding-agent", new URL("./runtime-stubs/pi-coding-agent.mjs", import.meta.url).href],
	["@earendil-works/pi-tui", new URL("./runtime-stubs/pi-tui.mjs", import.meta.url).href],
	["typebox", new URL("./runtime-stubs/typebox.mjs", import.meta.url).href],
]);

export function resolve(specifier, context, nextResolve) {
	const runtimeStub = runtimeStubs.get(specifier);
	if (runtimeStub) return { shortCircuit: true, url: runtimeStub };
	if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
		const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
		if (existsSync(fileURLToPath(candidate))) return { shortCircuit: true, url: candidate.href };
	}
	return nextResolve(specifier, context);
}
