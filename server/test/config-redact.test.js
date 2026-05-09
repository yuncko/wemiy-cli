import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveConfig } from "../src/cli/config/config-manager.js";

test("redactSensitiveConfig masks nested api keys", () => {
    const input = {
        provider: "openrouter",
        openrouter: { apiKey: "secret123", model: "x" },
        token: "abc",
    };
    const out = redactSensitiveConfig(input);
    assert.equal(out.openrouter.apiKey, "***");
    assert.equal(out.openrouter.model, "x");
    assert.equal(out.token, "***");
    assert.equal(out.provider, "openrouter");
});
