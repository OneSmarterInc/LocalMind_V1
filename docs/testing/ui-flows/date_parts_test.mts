import { parseLocalText, toLocalText } from "./dateParts.ts";
const cases: [string, boolean, boolean][] = [
  ["2026-02-31 10:00", false, false], ["2026-02-28 10:00", false, true], ["2024-02-29 00:00", false, true], ["2025-02-29 00:00", false, false],
  ["2026-13-01 10:00", false, false], ["2026-04-31", true, false], ["2026-04-30", true, true], ["2026-09-30 24:00", false, false],
  ["2026-09-30 23:59", false, true], ["2026-09-30T08:05", false, true], ["30/09/2026", true, false], ["2026-9-3", true, false],
];
let fail = 0;
for (const [text, dateOnly, ok] of cases) {
  const got = parseLocalText(text, dateOnly);
  if ((got !== null) !== ok) { fail++; console.log("FAIL", text, dateOnly, got); }
  if (got && toLocalText(got, dateOnly).replace("T", " ") !== text.replace("T", " ")) { fail++; console.log("FAIL round trip", text, toLocalText(got, dateOnly)); }
}
console.log(fail ? `${fail} failures` : `all ${cases.length} date cases pass`);
