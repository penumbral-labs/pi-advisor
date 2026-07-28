import assert from "node:assert/strict";
import test from "node:test";
import { getRuntimeCompleteSimple, isModuleNotFound } from "../extensions/advisor/advisor/pi-compat.ts";

test("runtime completion facade is returned bound to the runtime", async () => {
	const runtime = { marker: "runtime", completeSimple() { return this.marker; } };
	const complete = getRuntimeCompleteSimple({ runtime });
	assert.equal(await complete(), "runtime");
	assert.equal(getRuntimeCompleteSimple({ runtime: {} }), undefined);
});

test("module resolution classification walks nested causes without masking other errors", () => {
	assert.equal(isModuleNotFound(Object.assign(new Error(), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" })), true);
	assert.equal(isModuleNotFound({ cause: { code: "ERR_MODULE_NOT_FOUND" } }), true);
	assert.equal(isModuleNotFound(new Error("module initialized then failed")), false);
});
