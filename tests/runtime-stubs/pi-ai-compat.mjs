export async function completeSimple(model, context, options) {
	if (typeof globalThis.__piAdvisorCompatCompleteSimple === "function") {
		return globalThis.__piAdvisorCompatCompleteSimple(model, context, options);
	}
	throw new Error("No compatibility completeSimple test implementation configured");
}
