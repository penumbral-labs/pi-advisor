/** In-memory advisor selection and current executor mapping. */

import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";

let selectedAdvisor: Model<Api> | undefined;
let selectedAdvisorEffort: ThinkingLevel | undefined;
let activeExecutorKey: string | undefined;

export function getAdvisorModel(): Model<Api> | undefined { return selectedAdvisor; }
export function setAdvisorModel(model: Model<Api> | undefined): void { selectedAdvisor = model; }
export function getAdvisorEffort(): ThinkingLevel | undefined { return selectedAdvisorEffort; }
export function setAdvisorEffort(effort: ThinkingLevel | undefined): void { selectedAdvisorEffort = effort; }
export function getActiveExecutorKey(): string | undefined { return activeExecutorKey; }
export function setActiveExecutorKey(key: string | undefined): void { activeExecutorKey = key; }
