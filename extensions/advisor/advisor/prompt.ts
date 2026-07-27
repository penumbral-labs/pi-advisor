/** Load the advisor system prompt once from the shipped prompt asset. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ADVISOR_SYSTEM_PROMPT = readFileSync(
	fileURLToPath(new URL("../prompts/advisor-system.txt", import.meta.url)),
	"utf-8",
).trimEnd();
