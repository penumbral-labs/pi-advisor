/** Public surface for the modular advisor core. */

export { registerAdvisorCommand } from "./command.js";
export { loadAdvisorConfig, modelStubOf, parseModelStub, resolveAdvisorEntry, saveAdvisorConfig } from "./config.js";
export { ensureUserTailForAdvisor, stripInflightAdvisorCall } from "./context.js";
export { reconcileAdvisorTool, registerAdvisorBeforeAgentStart, registerModelSelectHandler } from "./handlers.js";
export { getInventoryMessage, stableStringify } from "./inventory.js";
export { ADVISOR_TOOL_NAME } from "./messages.js";
export { getRuntimeCompleteSimple, isModuleNotFound, loadCompleteSimple } from "./pi-compat.js";
export { DEFAULT_PROMPT_GUIDELINES, DEFAULT_PROMPT_SNIPPET, registerAdvisorTool } from "./register.js";
export { applyAdvisorForExecutor, registerAdvisorSessionStart, restoreAdvisorState } from "./restore.js";
export {
	getActiveExecutorKey, getAdvisorEffort, getAdvisorModel, setActiveExecutorKey, setAdvisorEffort, setAdvisorModel,
} from "./state.js";
