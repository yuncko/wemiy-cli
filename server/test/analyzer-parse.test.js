import test from "node:test";
import assert from "node:assert/strict";
import { parseAIResponse } from "../src/cli/services/analyzer.js";

test("parseAIResponse accepts object with issues", () => {
    const r = parseAIResponse({
        issues: [
            {
                file: "a.ts",
                line: 1,
                type: "bug",
                severity: "warning",
                message: "m",
                suggestion: "s",
            },
        ],
    });
    assert.equal(r.issues.length, 1);
});

test("parseAIResponse parses JSON string", () => {
    const raw = '{"issues":[{"file":"x.go","line":null,"type":"security","severity":"critical","message":"m","suggestion":"s"}]}';
    const r = parseAIResponse(raw);
    assert.equal(r.issues.length, 1);
});
