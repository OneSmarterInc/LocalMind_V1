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
/** The national number, with any country code taken off the front. Ten digits
 *  is what India and the US use and what the institution asks for; a number
 *  written with +91 or +1 in front still has to have ten after it. */
export const PHONE_DIGITS = 10;
const MAX_COUNTRY_CODE_DIGITS = 3;

/** The digits of the number itself, after removing a leading country code.
 *  Only a number written with a leading + has one to remove: bare digits are
 *  read as a national number, so 9876543210 keeps all ten. */
function nationalDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!raw.trim().startsWith("+")) return digits;
  for (let code = 1; code <= MAX_COUNTRY_CODE_DIGITS; code += 1) {
    if (digits.length - code === PHONE_DIGITS) return digits.slice(code);
  }
  return digits;
}

/** The complaint to show, or null when the number looks usable. Blank is fine:
 *  a phone number is optional everywhere it is asked for. */
export function phoneProblem(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (!ALLOWED.test(raw)) return "Use digits, spaces, brackets, hyphens and an optional leading +.";
  if (raw.includes("+") && !raw.startsWith("+")) return "A country code goes at the start, as +91.";
  const national = nationalDigits(raw);
  if (national.length === PHONE_DIGITS) return null;
  if (national.length < PHONE_DIGITS) return `That is ${national.length} digit${national.length === 1 ? "" : "s"}. A phone number needs ${PHONE_DIGITS}, not counting the country code.`;
  return `That is ${national.length} digits. A phone number is ${PHONE_DIGITS}, not counting the country code.`;
}
