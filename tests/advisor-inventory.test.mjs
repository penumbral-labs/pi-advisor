import assert from "node:assert/strict";
import test from "node:test";
import { getInventoryMessage, stableStringify } from "../extensions/advisor/advisor/inventory.ts";

const tool = (name, parameters = {}) => ({ name, description: `${name} description`, parameters, sourceInfo: { path: `/tmp/${name}` } });

test("stableStringify recursively sorts keys and follows JSON undefined semantics", () => {
	assert.equal(stableStringify({ b: 1, a: { d: 4, c: 3 }, z: undefined }), '{"a":{"c":3,"d":4},"b":1}');
	assert.equal(stableStringify([1, undefined, 2]), "[1,null,2]");
});

test("inventory is sorted, omits install paths, and caches by tool names", () => {
	const first = getInventoryMessage([tool("b", { z: 1, a: 2 }), tool("a")]);
	const second = getInventoryMessage([tool("a"), tool("b", { changed: true })]);
	assert.equal(first, second);
	const text = first.content[0].text;
	assert.ok(text.indexOf("### a") < text.indexOf("### b"));
	assert.match(text, /\{"a":2,"z":1\}/);
	assert.doesNotMatch(text, /\/tmp\//);
	assert.equal(getInventoryMessage([]), undefined);
});
