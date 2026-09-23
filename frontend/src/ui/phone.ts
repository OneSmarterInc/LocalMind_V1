/** Phone numbers, checked loosely on purpose.
 *
 * LocalMind is used wherever the institution is, so a strict national format
 * would reject correct numbers. What a check can honestly catch is a typo or
 * the wrong field: stray letters, too few digits to dial, more digits than any
 * country uses. E.164 allows at most 15 digits; the shortest usable national
 * numbers run to 7. Spaces, hyphens, brackets and a leading + are all normal
 * ways to write one and are accepted.
 */
const ALLOWED = /^[0-9+()\-. \u00a0]+$/;
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

/** The complaint to show, or null when the number looks usable. Blank is fine:
 *  a phone number is optional everywhere it is asked for. */
export function phoneProblem(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (!ALLOWED.test(raw)) return "Use digits, spaces, brackets, hyphens and an optional leading +.";
  if (raw.includes("+") && !raw.startsWith("+")) return "A country code goes at the start, as +91.";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < PHONE_MIN_DIGITS) return `That is ${digits.length} digit${digits.length === 1 ? "" : "s"}. A phone number needs at least ${PHONE_MIN_DIGITS}.`;
  if (digits.length > PHONE_MAX_DIGITS) return `That is ${digits.length} digits. A phone number has at most ${PHONE_MAX_DIGITS}, including the country code.`;
  return null;
}
