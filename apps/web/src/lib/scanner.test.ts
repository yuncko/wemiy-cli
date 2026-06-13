import { describe, expect, it } from "vitest";
import { detectAiPatterns, filterScannableFiles, parseGitHubRepoUrl } from "./scanner";
describe("parseGitHubRepoUrl", () => {
  it("parses https github urls", () => {
    expect(parseGitHubRepoUrl("https://github.com/vercel/ai")).toEqual({
      owner: "vercel",
      repo: "ai",
    });
  });

  it("rejects invalid urls", () => {
    expect(parseGitHubRepoUrl("not-a-url")).toBeNull();
  });
});

describe("detectAiPatterns", () => {
  it("finds openai sdk import", () => {
    const content = `import OpenAI from 'openai';\nconst client = new OpenAI();`;
    const findings = detectAiPatterns(content, "src/lib/ai.ts");
    expect(findings.some((f) => f.pattern === "openai-sdk")).toBe(true);
  });

  it("finds env var references", () => {
    const content = "const key = process.env.OPENAI_API_KEY;";
    const findings = detectAiPatterns(content, ".env.example");
    expect(findings.some((f) => f.pattern === "ai-env-var")).toBe(true);
  });
});

describe("filterScannableFiles", () => {
  it("prioritizes src/ paths and skips node_modules", () => {
    const paths = filterScannableFiles([
      { path: "node_modules/pkg/index.js", type: "blob", size: 100 },
      { path: "src/components/Chat.tsx", type: "blob", size: 200 },
      { path: "src/lib/ai.ts", type: "blob", size: 300 },
      { path: "package.json", type: "blob", size: 400 },
      { path: "README.md", type: "blob", size: 500 },
    ]);
    expect(paths).toContain("src/components/Chat.tsx");
    expect(paths).toContain("src/lib/ai.ts");
    expect(paths).toContain("package.json");
    expect(paths).not.toContain("node_modules/pkg/index.js");
    expect(paths.indexOf("src/lib/ai.ts")).toBeLessThan(paths.indexOf("README.md"));
  });

  it("enforces max file count", () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      path: `file-${i}.ts`,
      type: "blob",
      size: 10,
    }));
    const paths = filterScannableFiles(entries, { maxFiles: 10 });
    expect(paths).toHaveLength(10);
  });
});
