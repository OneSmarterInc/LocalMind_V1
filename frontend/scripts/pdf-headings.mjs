/**
 * Heading detection for PDFs, so a private import is split the way the book is
 * written rather than the way it was paginated.
 *
 * A Word file carries real heading styles. A PDF carries none, so this is
 * inference: numbered heading patterns first, then type size and weight. It
 * will be wrong on some books, which is why `headingItems` returns null rather
 * than a bad guess whenever the evidence is thin, and the caller falls back to
 * one module per page.
 */

const NUMBERED = /^(\d{1,2}(?:\.\d{1,3}){0,3})[.)]?\s+(\S.*)$/;
const ROMAN = /^(?:[IVXL]{1,6}|[A-Z])[.)]\s+\S/;
const ENDS_SENTENCE = /[.,;:]$/;
const MOSTLY_DIGITS = /^[\d\s.,()%/-]+$/;
// Display equations are the one thing on a textbook page that looks like a
// numbered heading: a small number, then a short line. Relations, operators,
// Greek letters and primes are what actually separate the two.
const MATHS = /[=+×÷√∫∑Σ∆∂∞±≈≤≥≠°′″πεσλμφθρΩ∈→←↔·•]|[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]|[−–—]\s*\d/u;
const LABELLED = /\b(?:figure|table|example|exercise|eq|equation|fig)\b/i;

const norm = value => String(value || "").replace(/\s+/g, " ").trim();
const key = value => norm(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

/** PDF small caps arrive as separate runs: "C ONDUCTORS" is one word, and a
 * possessive is set as its own run, so "GAUSS \u2019 S" is one word too. */
const joinSmallCaps = value => norm(value)
  .replace(/\b([A-Z]) ([A-Z]{2,})\b/g, "$1$2")
  .replace(/\s*\u2019\s*([Ss])\b/g, "\u2019$1");

/** Line art of algebra: mostly one-letter tokens standing in for symbols. */
function looksLikeAlgebra(text) {
  const words = text.split(" ").filter(Boolean);
  if (!words.length) return true;
  const single = words.filter(w => w.replace(/[^\p{L}\d]/gu, "").length <= 1).length;
  return single / words.length > 0.34;
}

function titleLike(rest) {
  const words = norm(rest).split(" ").filter(Boolean);
  if (words.length < 1) return false;
  // A heading names something. A sentence fragment that merely follows a
  // formula number starts in lower case and is not a heading.
  if (!/^[\p{Lu}\p{N}]/u.test(words[0])) return false;
  return words.filter(w => /\p{L}{2,}/u.test(w)).length >= 1;
}

/** The size most of the running text is set in, weighted by how much text. */
function bodySize(pages) {
  const weights = new Map();
  for (const page of pages) {
    for (const line of page.lines || []) {
      if (norm(line.text).length < 40) continue;
      const bucket = Math.round(line.size * 2) / 2;
      weights.set(bucket, (weights.get(bucket) || 0) + norm(line.text).length);
    }
  }
  let best = 0, top = 0;
  for (const [size, weight] of weights) if (weight > top) { top = weight; best = size; }
  return best || 10;
}

/** Heading candidates on one page, with the evidence that nominated each. */
export function pageHeadings(page, body) {
  const height = page.height || 0;
  const lines = (page.lines || []).map(line => ({ ...line, text: joinSmallCaps(line.text) }));
  const out = [];
  for (const [index, line] of lines.entries()) {
    const text = line.text;
    const words = text.split(" ").filter(Boolean);
    if (text.length < 4 || text.length > 110 || words.length > 14) continue;
    if (MOSTLY_DIGITS.test(text) || ENDS_SENTENCE.test(text)) continue;
    if (MATHS.test(text) || LABELLED.test(text) || looksLikeAlgebra(text)) continue;
    // Running heads and folios repeat on every page and are not structure.
    if (height && (line.y1 <= height * 0.08 || line.y0 >= height * 0.93)) continue;
    const numbered = NUMBERED.exec(text);
    const rest = numbered ? numbered[2] : text;
    if (!titleLike(rest)) continue;
    // Numbered exercises at the back of a chapter look exactly like numbered
    // headings, except that a heading names a topic in a few words and an
    // exercise is the opening clause of a sentence.
    if (numbered && rest.split(" ").filter(Boolean).length > 9) continue;
    const caps = text === text.toUpperCase() && /[A-Z]{3}/.test(text);
    const big = line.size >= body * 1.18;
    let evidence = "";
    if (numbered) evidence = "numbered";
    else if (big) evidence = "size";
    else if (caps && line.size >= body * 1.08) evidence = "caps";
    else if (ROMAN.test(text) && line.size >= body * 1.08) evidence = "lettered";
    if (!evidence) continue;
    // A heading that wraps is still one heading.
    let title = text;
    const next = lines[index + 1];
    if (next && Math.abs(next.size - line.size) <= 0.6 && next.y0 - line.y1 <= line.size * 1.2 &&
        !NUMBERED.test(next.text) && !ENDS_SENTENCE.test(next.text) && !MATHS.test(next.text) &&
        next.text.split(" ").filter(Boolean).length <= 8 && titleLike(next.text)) title = `${text} ${next.text}`;
    out.push({ text: norm(title), number: numbered ? numbered[1] : "", size: line.size, y0: line.y0, evidence });
  }
  return out;
}

/**
 * Every heading in the document, in reading order, or an empty list when the
 * evidence is too thin to act on.
 */
export function documentHeadings(pages) {
  const body = bodySize(pages);
  const found = [];
  for (const page of pages) for (const heading of pageHeadings(page, body)) found.push({ ...page && { page: page.page }, ...heading });
  let numbered = found.filter(h => h.evidence === "numbered");
  if (numbered.length >= 3) {
    // One chapter uses one numbering scheme. Keeping only the commonest first
    // component drops stray numbers picked up from worked examples.
    const counts = new Map();
    for (const h of numbered) {
      const prefix = h.number.split(".")[0];
      counts.set(prefix, (counts.get(prefix) || 0) + 1);
    }
    const dominant = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    numbered = numbered.filter(h => h.number.split(".")[0] === dominant);
    // A number used twice belongs to two different lists. The first use is the
    // chapter's own structure; the second is an exercise set or an appendix.
    const used = new Set();
    numbered = numbered.filter(h => (used.has(h.number) ? false : used.add(h.number)));
  }
  // A numbered scheme is the strongest evidence a PDF offers, and mixing it
  // with type-size guesses only adds noise, so it is used on its own.
  const chosen = numbered.length >= 3 ? numbered : found;
  const seen = new Set();
  return chosen.filter(h => {
    const id = `${h.page}:${key(h.text)}`;
    if (!key(h.text) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Where a heading falls inside the page text, matched on letters and digits. */
function splitAt(text, heading) {
  const wanted = key(heading);
  if (!wanted) return -1;
  const map = [];
  let flat = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toUpperCase();
    if (ch >= "A" && ch <= "Z" || ch >= "0" && ch <= "9") { flat += ch; map.push(i); }
  }
  const at = flat.indexOf(wanted);
  return at < 0 ? -1 : map[at];
}

/**
 * Source items split at headings instead of at page breaks, or null when the
 * document does not look like it has usable headings.
 *
 * Pages are the parser's own per-page records. A section spans whatever pages
 * it runs across, and each page's pictures go to the section holding most of
 * that page, which is what puts a figure with the text it illustrates.
 */
export function headingItems(pages) {
  const usable = (pages || []).filter(p => p && typeof p.text === "string");
  if (usable.length < 2) return null;
  const headings = documentHeadings(usable);
  const pagesWithHeading = new Set(headings.map(h => h.page)).size;
  // One heading is a chapter title, not a structure; and a heading on every
  // second line is a detector that has latched on to the running text.
  if (headings.length < 2 || pagesWithHeading < Math.min(2, usable.length) || headings.length > usable.length * 6) return null;

  const sections = [];
  let current = { title: "Introduction", parts: [], startPage: usable[0].page, endPage: usable[0].page, ocr: false };
  const commit = () => { if (current.parts.some(p => p.text.trim()) || current.visualIds?.length) sections.push(current); };
  const perPage = new Map();          // page -> [{section, chars}]
  const note = (page, chars) => {
    const rows = perPage.get(page) || [];
    const row = rows.find(r => r.section === current);
    if (row) row.chars += chars; else rows.push({ section: current, chars });
    perPage.set(page, rows);
  };

  for (const page of usable) {
    const text = page.text || "";
    const marks = headings.filter(h => h.page === page.page)
      .map(h => ({ heading: h, at: splitAt(text, h.text) }))
      .filter(m => m.at >= 0)
      .sort((a, b) => a.at - b.at);
    let cursor = 0;
    for (const mark of marks) {
      const before = text.slice(cursor, mark.at).trim();
      if (before) { current.parts.push({ text: before }); note(page.page, before.length); }
      current.endPage = page.page;
      commit();
      current = { title: norm(mark.heading.text).slice(0, 260), parts: [], startPage: page.page, endPage: page.page, ocr: false };
      cursor = mark.at;
    }
    const rest = text.slice(cursor).trim();
    if (rest) { current.parts.push({ text: rest }); note(page.page, rest.length); }
    current.endPage = page.page;
    if (page.ocr) current.ocr = true;
  }
  commit();
  if (sections.length < 2) return null;
  // A chapter title or a stray line above the first heading is not a module.
  for (let i = sections.length - 2; i >= 0; i--) {
    const section = sections[i];
    const chars = section.parts.map(p => p.text).join(" ").trim().length;
    if (chars >= 200) continue;
    const next = sections[i + 1];
    next.parts = [...section.parts, ...next.parts];
    next.startPage = Math.min(next.startPage, section.startPage);
    for (const rows of perPage.values()) for (const row of rows) if (row.section === section) row.section = next;
    sections.splice(i, 1);
  }
  if (sections.length < 2) return null;

  for (const section of sections) section.visualIds = [];
  for (const page of usable) {
    if (!page.visualIds?.length) continue;
    const rows = (perPage.get(page.page) || []).filter(r => sections.includes(r.section));
    const owner = rows.sort((a, b) => b.chars - a.chars)[0]?.section
      || sections.filter(s => s.startPage <= page.page).pop()
      || sections[0];
    owner.visualIds.push(...page.visualIds);
    if (page.ocr) owner.ocr = true;
  }

  return sections.map((section, index) => ({
    title: section.title,
    text: section.parts.map(p => p.text).join("\n\n"),
    page: section.startPage,
    endPage: section.endPage,
    group: `h${index + 1}`,
    visualIds: section.visualIds,
    ...(section.ocr ? { ocr: true } : {}),
  })).filter(item => item.text.trim() || item.visualIds.length);
}
