export function getSupportedThinkingLevels(model) {
	if (!model?.reasoning) return ["off"];
	const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	return levels.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}
