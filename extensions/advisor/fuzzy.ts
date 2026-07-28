/** Pure fuzzy-filter helpers for advisor pickers. */

import type { SelectItem } from "@earendil-works/pi-tui";

export function fuzzyScore(query: string, text: string): number | null {
	const needle = query.toLowerCase();
	const haystack = text.toLowerCase();
	if (needle.length === 0) return 0;
	let queryIndex = 0;
	let score = 0;
	let streak = 0;
	let previousMatch = -2;
	for (let index = 0; index < haystack.length && queryIndex < needle.length; index++) {
		if (haystack[index] !== needle[queryIndex]) continue;
		if (previousMatch === index - 1) score += 5 + ++streak;
		else { streak = 0; score += 1; }
		const previous = haystack[index - 1];
		if (index === 0 || previous === " " || previous === ":" || previous === "-") score += 3;
		previousMatch = index;
		queryIndex++;
	}
	return queryIndex === needle.length ? score : null;
}

export function filterItems(items: SelectItem[], query: string): SelectItem[] {
	if (query.length === 0) return items;
	return items
		.map((item, index) => ({ item, index, score: fuzzyScore(query, `${item.label} ${item.value}`) }))
		.filter((entry): entry is { item: SelectItem; index: number; score: number } => entry.score !== null)
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.map((entry) => entry.item);
}

export function isBackspace(data: string): boolean { return data === "\u007f" || data === "\b"; }
export function isPrintable(data: string): boolean {
	return data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) !== 0x7f;
}
