import { PDFDocument, StandardFonts, type PDFFont, rgb } from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const BODY_SIZE = 10;
const H1_SIZE = 18;
const H2_SIZE = 14;
const H3_SIZE = 12;
const TABLE_HEADER_SIZE = 9;
const TABLE_CELL_SIZE = 9;
const LINE_GAP = 4;

type MarkdownBlock =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "blank" };

type PdfContext = {
  pdf: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  font: PDFFont;
  fontBold: PDFFont;
  y: number;
};

function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((c) => stripMarkdownInline(c.trim()));
  return cells;
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|?$/.test(line.trim());
}

/** Parse markdown into renderable blocks (headings, paragraphs, tables). */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      blocks.push({ type: "blank" });
      i++;
      continue;
    }

    if (trimmed === "---" || trimmed === "***") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "h3", text: stripMarkdownInline(trimmed.slice(4)) });
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", text: stripMarkdownInline(trimmed.slice(3)) });
      i++;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push({ type: "h1", text: stripMarkdownInline(trimmed.slice(2)) });
      i++;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const headers = parseTableRow(trimmed);
      if (headers && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          const row = parseTableRow(lines[i]);
          if (row) rows.push(row);
          i++;
        }
        blocks.push({ type: "table", headers, rows });
        continue;
      }
    }

    const paraLines = [stripMarkdownInline(trimmed)];
    i++;
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("#") && !lines[i].trim().startsWith("|")) {
      paraLines.push(stripMarkdownInline(lines[i].trim()));
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (!text) return [" "];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [" "];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          const test = chunk + ch;
          if (font.widthOfTextAtSize(test, fontSize) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk = test;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [" "];
}

function ensureSpace(ctx: PdfContext, needed: number): void {
  if (ctx.y - needed >= MARGIN) return;
  ctx.page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.y = PAGE_HEIGHT - MARGIN;
}

function drawWrapped(
  ctx: PdfContext,
  text: string,
  fontSize: number,
  font: PDFFont,
  indent = 0,
  color = rgb(0.1, 0.1, 0.1)
): void {
  const maxWidth = PAGE_WIDTH - MARGIN * 2 - indent;
  const lineHeight = fontSize + LINE_GAP;

  for (const line of wrapText(text, font, fontSize, maxWidth)) {
    ensureSpace(ctx, lineHeight);
    ctx.page.drawText(line, {
      x: MARGIN + indent,
      y: ctx.y,
      size: fontSize,
      font,
      color,
    });
    ctx.y -= lineHeight;
  }
}

function drawTable(ctx: PdfContext, headers: string[], rows: string[][]): void {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  if (colCount === 0) return;

  const tableWidth = PAGE_WIDTH - MARGIN * 2;
  const colWidth = tableWidth / colCount;
  const cellPad = 4;
  const rowPad = 6;

  const renderRow = (cells: string[], font: PDFFont, fontSize: number, isHeader: boolean) => {
    const wrappedCells = cells.map((cell) =>
      wrapText(cell || "—", font, fontSize, colWidth - cellPad * 2)
    );
    const rowHeight =
      Math.max(...wrappedCells.map((lines) => lines.length), 1) * (fontSize + 2) + rowPad;

    ensureSpace(ctx, rowHeight + 4);

    const rowTop = ctx.y;
    for (let c = 0; c < colCount; c++) {
      const x = MARGIN + c * colWidth;
      const lines = wrappedCells[c] ?? ["—"];
      let cellY = rowTop - cellPad;
      for (const line of lines) {
        ctx.page.drawText(line, {
          x: x + cellPad,
          y: cellY,
          size: fontSize,
          font,
          color: isHeader ? rgb(0.05, 0.05, 0.05) : rgb(0.15, 0.15, 0.15),
        });
        cellY -= fontSize + 2;
      }
      ctx.page.drawLine({
        start: { x, y: rowTop + 4 },
        end: { x, y: rowTop - rowHeight + 4 },
        thickness: 0.5,
        color: rgb(0.75, 0.75, 0.75),
      });
    }

    ctx.page.drawLine({
      start: { x: MARGIN, y: rowTop - rowHeight + 4 },
      end: { x: MARGIN + tableWidth, y: rowTop - rowHeight + 4 },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });

    ctx.y = rowTop - rowHeight - 4;
  };

  const paddedHeaders = headers.concat(Array(Math.max(0, colCount - headers.length)).fill(""));
  renderRow(paddedHeaders, ctx.fontBold, TABLE_HEADER_SIZE, true);

  for (const row of rows) {
    const padded = row.concat(Array(Math.max(0, colCount - row.length)).fill(""));
    renderRow(padded, ctx.font, TABLE_CELL_SIZE, false);
  }

  ctx.y -= 8;
}

function renderBlock(ctx: PdfContext, block: MarkdownBlock): void {
  switch (block.type) {
    case "blank":
      ctx.y -= BODY_SIZE;
      break;
    case "hr":
      ensureSpace(ctx, 16);
      ctx.page.drawLine({
        start: { x: MARGIN, y: ctx.y },
        end: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
        thickness: 0.75,
        color: rgb(0.7, 0.7, 0.7),
      });
      ctx.y -= 16;
      break;
    case "h1":
      ensureSpace(ctx, H1_SIZE + 8);
      ctx.y -= 4;
      drawWrapped(ctx, block.text, H1_SIZE, ctx.fontBold);
      ctx.y -= 6;
      break;
    case "h2":
      ensureSpace(ctx, H2_SIZE + 6);
      ctx.y -= 2;
      drawWrapped(ctx, block.text, H2_SIZE, ctx.fontBold);
      ctx.y -= 4;
      break;
    case "h3":
      ensureSpace(ctx, H3_SIZE + 4);
      drawWrapped(ctx, block.text, H3_SIZE, ctx.fontBold);
      ctx.y -= 2;
      break;
    case "paragraph":
      drawWrapped(ctx, block.text, BODY_SIZE, ctx.font);
      ctx.y -= 4;
      break;
    case "table":
      drawTable(ctx, block.headers, block.rows);
      break;
  }
}

export async function markdownToPdf(markdown: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ctx: PdfContext = {
    pdf,
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    font,
    fontBold,
    y: PAGE_HEIGHT - MARGIN,
  };

  const blocks = parseMarkdownBlocks(markdown);
  for (const block of blocks) {
    renderBlock(ctx, block);
  }

  return pdf.save();
}
