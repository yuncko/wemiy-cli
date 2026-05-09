import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, cleanMarkdown } from "../src/cli/lib/json-ai-parse.js";

test("extractJson parses fenced JSON block", () => {
    const raw = 'Here:\n```json\n{"a":1}\n```';
    assert.deepEqual(extractJson(raw), { a: 1 });
});

test("extractJson parses brace slice when no fence", () => {
    const raw = 'prefix {"x":true} suffix';
    assert.deepEqual(extractJson(raw), { x: true });
});

test("extractJson throws on invalid JSON", () => {
    assert.throws(() => extractJson("not json"), /Failed to parse JSON/);
});

test("cleanMarkdown strips fenced code", () => {
    assert.equal(cleanMarkdown("```ts\nhello\n```"), "hello");
});
