/** Conservative display parser for the Markdown emitted by our document parser.
 * This is a rendering view, NOT the stable ContentBlock authoring schema from
 * the architecture guideline. Unsupported constructs remain readable text.
 * No HTML evaluation, external images, or automatic remote resource fetching.
 */
export type ReadingBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph" | "code"; text: string }
  | { kind: "list"; items: { label: string; text: string; depth: number }[] }
  | { kind: "table"; header: string[]; rows: string[][] };

export function tableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  const out: string[] = [];
  let cell = "", escaped = false;
  for (const c of value) {
    if (escaped) { cell += c === "|" || c === "\\" ? c : `\\${c}`; escaped = false; }
    else if (c === "\\") escaped = true;
    else if (c === "|") { out.push(cell.trim()); cell = ""; }
    else cell += c;
  }
  if (escaped) cell += "\\";
  out.push(cell.trim());
  return out.map((c) => c.replace(/<br\s*\/?\s*>/gi, "\n"));
}

const listLine = /^(\s*)([-*+•]|(?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)(?:\.(?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+))+[.)]?|\d+[.)]|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]+[.)])\s+(.+)$/;
function isDivider(line: string) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

export function parseReadingBlocks(source: string): ReadingBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReadingBlock[] = [];
  let i = 0;
  const heading = (s: string) => /^(#{1,6})\s+(.+)$/.exec(s.trim());
  const tableAt = (at: number) => lines[at]?.includes("|") && at + 1 < lines.length && isDivider(lines[at + 1]);
  while (i < lines.length) {
    if (!lines[i].trim() || lines[i].trim() === "<!-- page break -->") { i++; continue; }
    const h = heading(lines[i]);
    if (h) { blocks.push({ kind: "heading", level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*```/.test(lines[i])) {
      const content: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) content.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: "code", text: content.join("\n") }); continue;
    }
    if (tableAt(i)) {
      const header = tableCells(lines[i]); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(tableCells(lines[i++]));
      // Do not silently truncate irregular rows: pad the header and all rows.
      const columns = Math.max(header.length, ...rows.map((r) => r.length));
      while (header.length < columns) header.push(`Column ${header.length + 1}`);
      rows.forEach((r) => { while (r.length < columns) r.push(""); });
      blocks.push({ kind: "table", header, rows }); continue;
    }
    if (listLine.test(lines[i])) {
      const items: { label: string; text: string; depth: number }[] = [];
      while (i < lines.length) {
        const match = listLine.exec(lines[i]);
        if (match) {
          items.push({ label: /^[-*+•]$/.test(match[2]) ? "•" : match[2], text: match[3], depth: Math.floor(match[1].length / 2) });
          i++; continue;
        }
        if (!lines[i].trim() && i + 1 < lines.length && listLine.test(lines[i + 1])) { i++; continue; }
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1].text += `\n${lines[i++].trim()}`; continue; }
        break;
      }
      blocks.push({ kind: "list", items }); continue;
    }
    const paragraph: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !heading(lines[i]) && !listLine.test(lines[i]) && !tableAt(i) && !/^\s*```/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}
