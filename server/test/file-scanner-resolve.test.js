import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { resolveScanEntries } from "../src/cli/utils/file-scanner.js";

test("resolveScanEntries skips path traversal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wemiy-scan-"));
    await writeFile(path.join(root, "safe.ts"), "//ok", "utf8");
    const entries = await resolveScanEntries(root, ["../outside.ts", "safe.ts"]);
    assert.equal(entries.length, 1);
    assert.ok(entries[0].relativePath.includes("safe.ts"));
});

test("resolveScanEntries respects extension allowlist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wemiy-scan2-"));
    await writeFile(path.join(root, "x.ts"), "1", "utf8");
    await writeFile(path.join(root, "y.bin"), "1", "utf8");
    const entries = await resolveScanEntries(root, ["x.ts", "y.bin"]);
    assert.equal(entries.length, 1);
});
