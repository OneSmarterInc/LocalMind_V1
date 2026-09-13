/**
 * LocalMind design tokens (UI direction 01: calm green on a warm off-white).
 *
 * Every screen imports colours from here. Keys are kept from the previous dark
 * theme so existing screens re-skin without edits; `ink`, `pale` and the tone
 * table are new.
 */
export const colors = {
  // canvas + surfaces
  bg: "#F5F7F4",
  sidebar: "#FFFFFF",
  surface: "#FFFFFF",
  surface2: "#F8FAF7",
  border: "#DFE6DF",
  borderStrong: "#CBD8CC",
  rowLine: "#EDF1EA",

  // type
  ink: "#21382E",
  text: "#354B40",
  muted: "#62746A",
  faint: "#879287",

  // brand + semantic
  primary: "#236148",
  primaryDark: "#174B36",
  primaryText: "#FFFFFF",
  pale: "#EAF2EC",
  accent: "#355E87",
  purple: "#735989",
  danger: "#A33936",
  success: "#3F7D56",
  warning: "#926216",

  // tinted fills
  chipBg: "#F3F6F2",
  lockedBg: "#F1F3EF",
  tealTint: "#EAF2EC",
  blueTint: "#EDF3FA",
  purpleTint: "#F1EDF7",
  yellowTint: "#FFF5DD",
  dangerTint: "#FFF0EE",
};

/** Flat fills; the design has no gradients. Kept so <Gradient/> call sites still work. */
export const gradients = {
  brand: ["#236148", "#236148"] as const,
  sidebar: ["#FFFFFF", "#FFFFFF"] as const,
  hero: ["#EAF1E5", "#EAF1E5"] as const,
  card: ["#FFFFFF", "#FFFFFF"] as const,
  progress: ["#518965", "#518965"] as const,
};

/** Soft background + strong foreground for badges, tiles and notices. */
export type Tone = "green" | "amber" | "red" | "blue" | "purple" | "neutral";
export const tones: Record<Tone, { bg: string; fg: string; border: string }> = {
  green: { bg: "#E9F3EB", fg: "#28583D", border: "#DBE9DE" },
  amber: { bg: "#FFF5DD", fg: "#8C5B0E", border: "#EBDFBD" },
  red: { bg: "#FFF0EE", fg: "#A33936", border: "#EDD5D0" },
  blue: { bg: "#EDF3FA", fg: "#355E87", border: "#DAE5F1" },
  purple: { bg: "#F1EDF7", fg: "#735989", border: "#E2DAEC" },
  neutral: { bg: "#F1F3EF", fg: "#62746A", border: "#DFE6DF" },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = 14;
export const radiusSm = 8;

/** Responsive breakpoints shared by the shell and the Screen container. */
export const bp = { tablet: 700, desktop: 1000 };

export const font = {
  h1: { fontSize: 30, fontWeight: "600" as const, letterSpacing: -0.85, lineHeight: 37 },
  h2: { fontSize: 18, fontWeight: "600" as const, letterSpacing: -0.25, lineHeight: 24 },
  h3: { fontSize: 15, fontWeight: "600" as const, lineHeight: 22 },
  body: { fontSize: 14, lineHeight: 22 },
  small: { fontSize: 12, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: "600" as const },
  eyebrow: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.8, textTransform: "uppercase" as const },
};

/** Which tone a backend status value is shown in. */
export const statusTone: Record<string, Tone> = {
  active: "green", published: "green", evaluated: "green", completed: "green", open: "green", ready: "green", passed: "green", enrolled: "green", resolved: "green",
  discontinued: "red", error: "red", failed: "red", critical: "red", high: "red", confirmed: "red",
  needs_review: "amber", pending_evaluation: "amber", under_review: "amber", held: "amber", medium: "amber", pending: "amber", generating: "amber", in_review: "amber",
  processing: "blue", in_progress: "blue", submitted: "blue", uploaded: "blue", low: "blue", investigating: "blue",
  archived: "neutral", draft: "neutral", closed: "neutral", locked: "neutral", superseded: "neutral", false_positive: "neutral", not_started: "neutral",
};

/** Kept for call sites that colour text by status. */
export const statusColor: Record<string, string> = Object.fromEntries(
  Object.entries(statusTone).map(([k, t]) => [k, tones[t].fg]),
);
