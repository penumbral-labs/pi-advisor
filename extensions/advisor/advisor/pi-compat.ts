/** Host-version-tolerant resolver for Pi's completion API. */

type CompleteSimpleFn = typeof import("@earendil-works/pi-ai/compat").completeSimple;

export function getRuntimeCompleteSimple(modelRegistry: unknown): CompleteSimpleFn | undefined {
	if (modelRegistry === null || typeof modelRegistry !== "object") return undefined;
	const runtime = (modelRegistry as { runtime?: unknown }).runtime;
	if (runtime === null || typeof runtime !== "object") return undefined;
	const completeSimple = (runtime as { completeSimple?: unknown }).completeSimple;
	return typeof completeSimple === "function" ? completeSimple.bind(runtime) as CompleteSimpleFn : undefined;
}

const MODULE_NOT_FOUND_CODES = new Set(["ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]);

export function isModuleNotFound(err: unknown): boolean {
	for (let current = err, depth = 0; current != null && depth < 16; depth++) {
		if (typeof current === "object" && MODULE_NOT_FOUND_CODES.has((current as { code?: string }).code ?? "")) return true;
		current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
	}
	return false;
}

export async function loadCompleteSimple(): Promise<CompleteSimpleFn> {
	let module: { completeSimple?: CompleteSimpleFn };
	try {
		module = await import("@earendil-works/pi-ai/compat");
	} catch (err) {
		if (!isModuleNotFound(err)) throw err;
		module = await import("@earendil-works/pi-ai");
	}
	if (typeof module.completeSimple !== "function") {
		throw new Error("pi-ai does not expose completeSimple on /compat or the package root — unsupported host pi-ai version");
	}
	return module.completeSimple;
}
