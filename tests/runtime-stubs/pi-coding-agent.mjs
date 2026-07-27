class Component {
	addChild() {}
	invalidate() {}
	render() { return []; }
}

export class DynamicBorder extends Component {}

export function buildSessionContext(entries, leafId) {
	if (typeof globalThis.__piCodingAgentBuildSessionContext === "function") {
		return globalThis.__piCodingAgentBuildSessionContext(entries, leafId);
	}
	return {
		messages: (entries ?? []).filter((entry) => entry?.type === "message").map((entry) => entry.message),
		thinkingLevel: "off",
		model: null,
	};
}

export function convertToLlm(messages) {
	return (messages ?? []).flatMap((message) => {
		if (message.role === "compactionSummary") {
			return [{ role: "user", content: [{ type: "text", text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${message.summary}\n</summary>` }], timestamp: message.timestamp }];
		}
		if (message.role === "branchSummary") {
			return [{ role: "user", content: [{ type: "text", text: `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${message.summary}\n</summary>` }], timestamp: message.timestamp }];
		}
		return [message];
	});
}
