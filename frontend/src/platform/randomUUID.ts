/**
 * crypto.randomUUID for plain-http addresses.
 *
 * Browsers expose crypto.randomUUID only in secure contexts (HTTPS or localhost).
 * A campus server or the shared launcher reached by a LAN address such as
 * http://192.168.1.20:8000 is not one, so every expo-crypto randomUUID() call
 * threw "randomUUID is not a function": importing a private book, queueing a
 * faculty upload, preparing a book on the device, saving a doubt, and recording
 * offline quiz attempts all failed there, online or not.
 *
 * crypto.getRandomValues is available on every origin, so a standard version-4
 * UUID is built from it. Installed only where randomUUID is missing; HTTPS,
 * localhost, iOS and Android keep their native implementation untouched.
 */
export function installRandomUUID(): void {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== "function" || typeof c.randomUUID === "function") return;
  const hex = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
  const randomUUID = () => {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const h = Array.from(b, (x) => hex[x]);
    return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}` as `${string}-${string}-${string}-${string}-${string}`;
  };
  try { Object.defineProperty(c, "randomUUID", { value: randomUUID, configurable: true, writable: true }); }
  catch { /* a frozen crypto object: leave it; nothing else to do */ }
}
