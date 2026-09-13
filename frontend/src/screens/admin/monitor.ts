import type { MonitorSeverity } from "@/api/types";
import { colors } from "@/ui";
import type { Tone } from "@/ui/theme";

export const SEVERITY_COLOR: Record<MonitorSeverity, string> = { low: colors.muted, medium: colors.warning, high: colors.danger, critical: colors.purple };
export const SEVERITY_TONE: Record<string, Tone> = { low: "blue", medium: "amber", high: "red", critical: "purple" };
export const STATUS_TONE: Record<string, Tone> = { open: "blue", escalated: "red", needs_investigation: "amber", confirmed: "purple", false_positive: "neutral", closed: "green" };
export const ISSUE_LABEL: Record<string, string> = {
  none: "No issue", hallucination: "Hallucination", factual_error: "Factual error", unsupported_claim: "Unsupported claim", instruction_violation: "Instruction violation",
  quiz_error: "Quiz error", safety: "Safety", irrelevant: "Irrelevant", other: "Other",
};
export const label = (s: string) => s.replace(/_/g, " ");
export const sentence = (s: string) => { const t = label(s); return t.charAt(0).toUpperCase() + t.slice(1); };
