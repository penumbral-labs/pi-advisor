/** Filterable bordered select panels used by /advisor. */

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { filterItems, isBackspace, isPrintable } from "./fuzzy.js";

const MAX_VISIBLE_ROWS = 10;
const NAV_HINT = "type to filter  •  ↑↓ navigate  •  enter select  •  esc cancel";
const PANEL_TEXT = {
	mappings: ["Advisor Mappings", "Each executor can have a different advisor model. Select an executor to configure its advisor pairing. The active executor is marked."],
	advisor: ["Advisor Tool", "When the active model needs stronger judgment, it escalates to the advisor model for guidance, then resumes.", "Pairing a fast executor with a more capable advisor can reduce token usage while preserving judgment."],
	effort: ["Reasoning Level", "Choose the reasoning effort level for the advisor. Higher levels use more tokens."],
	nudge: ["Nudge Sensitivity", "Choose how aggressively automatic advisor nudges fire for this executor."],
} as const;

function listTheme(theme: Theme) {
	return {
		selectedPrefix: (text: string) => theme.bg("selectedBg", theme.fg("accent", text)),
		selectedText: (text: string) => theme.bg("selectedBg", theme.bold(text)),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("dim", text),
		noMatch: (text: string) => theme.fg("warning", text),
	};
}

interface PickerOptions { title: string; prose: readonly string[]; items: SelectItem[]; preferredValue?: string; }

export function buildSelectPanel(theme: Theme, options: PickerOptions, query: string, list: SelectList): Container {
	const container = new Container();
	const border = () => new DynamicBorder((text: string) => theme.fg("accent", text));
	container.addChild(border());
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("accent", theme.bold(options.title)), 1, 0));
	for (const line of options.prose) { container.addChild(new Spacer(1)); container.addChild(new Text(line, 1, 0)); }
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg(query ? "accent" : "dim", query ? `Filter: ${query}` : "Type to filter…"), 1, 0));
	container.addChild(new Spacer(1));
	container.addChild(list);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("dim", NAV_HINT), 1, 0));
	container.addChild(new Spacer(1));
	container.addChild(border());
	return container;
}

function showFilterablePicker(ctx: ExtensionContext, options: PickerOptions): Promise<string | null> {
	return ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		let query = "";
		let list: SelectList;
		let container: Container;
		const rebuild = () => {
			const filtered = filterItems(options.items, query);
			list = new SelectList(filtered, Math.min(Math.max(filtered.length, 1), MAX_VISIBLE_ROWS), listTheme(theme));
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(null);
			if (!query && options.preferredValue) {
				const index = filtered.findIndex((item) => item.value === options.preferredValue);
				if (index >= 0) list.setSelectedIndex(index);
			}
			container = buildSelectPanel(theme, options, query, list);
		};
		rebuild();
		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				if (isBackspace(data)) { if (query) { query = query.slice(0, -1); rebuild(); } }
				else if (isPrintable(data)) { query += data; rebuild(); }
				else list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

function panel(type: keyof typeof PANEL_TEXT, items: SelectItem[], preferredValue?: string): PickerOptions {
	const [title, ...prose] = PANEL_TEXT[type];
	return { title, prose, items, preferredValue };
}

export function showMappingsPicker(ctx: ExtensionContext, items: SelectItem[], initialIndex?: number): Promise<string | null> {
	return showFilterablePicker(ctx, panel("mappings", items, initialIndex === undefined ? undefined : items[initialIndex]?.value));
}
export function showAdvisorPicker(ctx: ExtensionContext, items: SelectItem[]): Promise<string | null> {
	return showFilterablePicker(ctx, panel("advisor", items));
}
export function showNudgePicker(ctx: ExtensionContext, items: SelectItem[], initialIndex?: number): Promise<string | null> {
	return showFilterablePicker(ctx, panel("nudge", items, initialIndex === undefined ? undefined : items[initialIndex]?.value));
}
export function showEffortPicker(ctx: ExtensionContext, items: SelectItem[], current: ThinkingLevel | undefined, fallback: ThinkingLevel): Promise<string | null> {
	return showFilterablePicker(ctx, panel("effort", items, items.some((item) => item.value === current) ? current : fallback));
}
