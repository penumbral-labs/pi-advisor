/** @penumbral-labs/pi-advisor extension entrypoint. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerAdvisorBeforeAgentStart,
	registerAdvisorCommand,
	registerAdvisorNudges,
	registerAdvisorSessionStart,
	registerAdvisorTool,
	registerModelSelectHandler,
} from "./advisor/index.js";

export default function advisorExtension(pi: ExtensionAPI) {
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
	registerAdvisorBeforeAgentStart(pi);
	registerModelSelectHandler(pi);
	registerAdvisorNudges(pi);
	registerAdvisorSessionStart(pi);
}
