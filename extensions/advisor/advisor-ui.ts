/**
 * advisor-ui — bordered search+select panel builders for the /advisor command.
 *
 * All three panels (mappings, advisor, effort) share a single buildSelectPanel
 * helper that owns layout, the embedded search Input, and fuzzy-filtered
 * SelectList swapping. Nav keys (↑↓ enter) go to the list; everything else
 * goes to the search input, which re-filters via fuzzyFilter on every keystroke.
 */

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, getKeybindings, Input, type SelectItem, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

const MAX_VISIBLE_ROWS = 10;
const NAV_HINT = "type to filter  \u2022  \u2191\u2193 navigate  \u2022  enter select  \u2022  esc cancel";

// ---------------------------------------------------------------------------
// Panel prose constants
// ---------------------------------------------------------------------------

const MAPPINGS_HEADER_TITLE = "Advisor Mappings";
const MAPPINGS_HEADER_PROSE =
	"Each executor can have a different advisor model. Select an executor " +
	"to configure its advisor pairing. The active executor is marked.";

const ADVISOR_HEADER_TITLE = "Advisor Tool";
const ADVISOR_HEADER_PROSE_1 =
	"When the active model needs stronger judgment — a complex decision, an ambiguous " +
	"failure, a problem it's circling without progress — it escalates to the " +
	"advisor model for guidance, then resumes. The advisor runs server-side " +
	"and uses additional tokens.";
const ADVISOR_HEADER_PROSE_2 =
	"For certain workloads, pairing a faster model as the main model with a " +
	"more capable one as the advisor gives near-top-tier performance with " +
	"reduced token usage.";

const EFFORT_HEADER_TITLE = "Reasoning Level";
const EFFORT_HEADER_PROSE =
	"Choose the reasoning effort level for the advisor. " +
	"Higher levels produce stronger judgment but use more tokens.";

const NUDGE_HEADER_TITLE = "Nudge Sensitivity";
const NUDGE_HEADER_PROSE =
	"How aggressively the advisor nudge fires for this executor. " +
	"Smaller or less reliable models benefit from heavier nudging; " +
	"stronger models can be left to self-direct.";

// ---------------------------------------------------------------------------
// Shared theme helper
// ---------------------------------------------------------------------------

function selectListTheme(theme: Theme) {
	return {
		selectedPrefix: (t: string) => theme.bg("selectedBg", theme.fg("accent", t)),
		selectedText: (t: string) => theme.bg("selectedBg", theme.bold(t)),
		description: (t: string) => theme.fg("muted", t),
		scrollInfo: (t: string) => theme.fg("dim", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};
}

// ---------------------------------------------------------------------------
// Core panel builder — shared by all three show* functions
// ---------------------------------------------------------------------------

function buildSelectPanel(
	theme: Theme,
	title: string,
	proseLines: string[],
	masterItems: SelectItem[],
	initialIndex: number | undefined,
	onSelect: (value: string) => void,
	onCancel: () => void,
): { container: Container; handleInput: (data: string) => void } {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));

	container.addChild(border());
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
	container.addChild(new Spacer(1));
	for (const line of proseLines) {
		container.addChild(new Text(line, 1, 0));
		container.addChild(new Spacer(1));
	}

	// Embedded search input
	const searchInput = new Input();
	container.addChild(searchInput);
	container.addChild(new Spacer(1));

	// Inner container whose sole child is swapped on each filter change
	const listContainer = new Container();
	container.addChild(listContainer);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("dim", NAV_HINT), 1, 0));
	container.addChild(new Spacer(1));
	container.addChild(border());

	// Build (or rebuild) the SelectList. When a query is present the items are
	// fuzzy-filtered; the initial index is only applied on the first unfiltered build.
	let currentSelectList: SelectList;

	function rebuildList(query: string, preferredIndex?: number): void {
		listContainer.clear();
		const filtered =
			query.length > 0
				? fuzzyFilter(masterItems, query, (item) => item.label)
				: masterItems;
		currentSelectList = new SelectList(
			filtered,
			Math.min(Math.max(filtered.length, 1), MAX_VISIBLE_ROWS),
			selectListTheme(theme),
		);
		if (!query && preferredIndex !== undefined && preferredIndex >= 0) {
			currentSelectList.setSelectedIndex(preferredIndex);
		}
		currentSelectList.onSelect = (item) => onSelect(item.value);
		currentSelectList.onCancel = onCancel;
		listContainer.addChild(currentSelectList);
	}

	rebuildList("", initialIndex);

	// Input routing: nav/confirm go to the list, cancel exits, all else types into search.
	const kb = getKeybindings();

	function handleInput(data: string): void {
		if (
			kb.matches(data, "tui.select.up") ||
			kb.matches(data, "tui.select.down") ||
			kb.matches(data, "tui.select.confirm")
		) {
			currentSelectList.handleInput(data);
		} else if (kb.matches(data, "tui.select.cancel")) {
			onCancel();
		} else {
			searchInput.handleInput(data);
			rebuildList(searchInput.getValue());
		}
	}

	return { container, handleInput };
}

// ---------------------------------------------------------------------------
// Public panel functions
// ---------------------------------------------------------------------------

export async function showMappingsPicker(
	ctx: ExtensionContext,
	items: SelectItem[],
	initialIndex?: number,
): Promise<string | null> {
	return ctx.ui.custom<string | null>((_tui, theme, _kb, done) => {
		const { container, handleInput } = buildSelectPanel(
			theme,
			MAPPINGS_HEADER_TITLE,
			[MAPPINGS_HEADER_PROSE],
			items,
			initialIndex,
			(value) => done(value),
			() => done(null),
		);
		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				handleInput(data);
				_tui.requestRender();
			},
		};
	});
}

export async function showAdvisorPicker(ctx: ExtensionContext, items: SelectItem[]): Promise<string | null> {
	return ctx.ui.custom<string | null>((_tui, theme, _kb, done) => {
		const { container, handleInput } = buildSelectPanel(
			theme,
			ADVISOR_HEADER_TITLE,
			[ADVISOR_HEADER_PROSE_1, ADVISOR_HEADER_PROSE_2],
			items,
			undefined,
			(value) => done(value),
			() => done(null),
		);
		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				handleInput(data);
				_tui.requestRender();
			},
		};
	});
}

export async function showNudgePicker(
	ctx: ExtensionContext,
	items: SelectItem[],
	initialIndex?: number,
): Promise<string | null> {
	return ctx.ui.custom<string | null>((_tui, theme, _kb, done) => {
		const { container, handleInput } = buildSelectPanel(
			theme,
			NUDGE_HEADER_TITLE,
			[NUDGE_HEADER_PROSE],
			items,
			initialIndex,
			(value) => done(value),
			() => done(null),
		);
		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				handleInput(data);
				_tui.requestRender();
			},
		};
	});
}

export async function showEffortPicker(
	ctx: ExtensionContext,
	items: SelectItem[],
	currentEffort: ThinkingLevel | undefined,
	defaultEffort: ThinkingLevel,
): Promise<string | null> {
	const preferredIdx = currentEffort ? items.findIndex((item) => item.value === currentEffort) : -1;
	const initialIndex = preferredIdx >= 0 ? preferredIdx : items.findIndex((item) => item.value === defaultEffort);

	return ctx.ui.custom<string | null>((_tui, theme, _kb, done) => {
		const { container, handleInput } = buildSelectPanel(
			theme,
			EFFORT_HEADER_TITLE,
			[EFFORT_HEADER_PROSE],
			items,
			initialIndex >= 0 ? initialIndex : undefined,
			(value) => done(value),
			() => done(null),
		);
		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				handleInput(data);
				_tui.requestRender();
			},
		};
	});
}
