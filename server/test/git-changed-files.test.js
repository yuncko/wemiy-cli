import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { getRepoChangedRelativePaths } from "../src/cli/lib/git-changed-files.js";

test("getRepoChangedRelativePaths lists modified tracked file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wemiy-git-"));
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync('git config user.email "t@test.dev"', { cwd: dir, stdio: "pipe" });
    execSync('git config user.name "test"', { cwd: dir, stdio: "pipe" });
    writeFileSync(path.join(dir, "mod.ts"), "// v1", "utf8");
    execSync("git add mod.ts && git commit -m init", { cwd: dir, stdio: "pipe" });
    writeFileSync(path.join(dir, "mod.ts"), "// v2", "utf8");

    const paths = await getRepoChangedRelativePaths(dir);
    assert.ok(paths.some((p) => p.replace(/\\/g, "/").endsWith("mod.ts")));
});

test("getRepoChangedRelativePaths includes untracked code file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wemiy-git2-"));
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync('git config user.email "t@test.dev"', { cwd: dir, stdio: "pipe" });
    execSync('git config user.name "test"', { cwd: dir, stdio: "pipe" });
    writeFileSync(path.join(dir, "base.ts"), "// x", "utf8");
    execSync("git add base.ts && git commit -m init", { cwd: dir, stdio: "pipe" });
    writeFileSync(path.join(dir, "new.vue"), "<template/>", "utf8");

    const paths = await getRepoChangedRelativePaths(dir);
    assert.ok(paths.some((p) => p.replace(/\\/g, "/").endsWith("new.vue")));
});
