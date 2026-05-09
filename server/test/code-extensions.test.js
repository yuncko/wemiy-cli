import test from "node:test";
import assert from "node:assert/strict";
import {
    pathHasCodeExtension,
    filterPathsToCodeFiles,
} from "../src/cli/lib/code-extensions.js";

test("pathHasCodeExtension recognizes supported extensions", () => {
    assert.equal(pathHasCodeExtension("src/foo.ts"), true);
    assert.equal(pathHasCodeExtension("readme.md"), false);
});

test("filterPathsToCodeFiles dedupes and filters", () => {
    assert.deepEqual(filterPathsToCodeFiles(["a.ts", "a.ts", "b.md", "c.vue"]), [
        "a.ts",
        "c.vue",
    ]);
});
