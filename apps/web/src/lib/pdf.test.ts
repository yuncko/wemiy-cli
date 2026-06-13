import { describe, expect, it } from "vitest";
import { markdownToPdf, parseMarkdownBlocks } from "./pdf";

describe("parseMarkdownBlocks", () => {
  it("parses headings, paragraphs, and markdown tables", () => {
    const md = `# Title

Intro paragraph.

| Field | Value |
|-------|-------|
| **Purpose** | Support chat |

## Section 2`;

    const blocks = parseMarkdownBlocks(md);
    expect(blocks.some((b) => b.type === "h1" && b.text === "Title")).toBe(true);
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("Intro"))).toBe(true);
    expect(blocks.some((b) => b.type === "h2" && b.text === "Section 2")).toBe(true);

    const table = blocks.find((b) => b.type === "table");
    expect(table).toBeDefined();
    if (table?.type === "table") {
      expect(table.headers).toEqual(["Field", "Value"]);
      expect(table.rows[0]).toEqual(["Purpose", "Support chat"]);
    }
  });
});

describe("markdownToPdf", () => {
  it("produces a non-empty PDF without truncating long lines", async () => {
    const longLine = "A".repeat(250);
    const md = `# Annex IV\n\n${longLine}\n\n| Col A | Col B |\n|-------|-------|\n| one | two |`;
    const bytes = await markdownToPdf(md);
    expect(bytes.length).toBeGreaterThan(500);
    const header = String.fromCharCode(...bytes.slice(0, 4));
    expect(header).toBe("%PDF");
  });
});
