import { errorMessage } from "@/api/client";
import { alertAsync, choiceAsync } from "@/ui/Confirm";

/**
 * Unsaved work that in-app navigation must not silently leave behind. An editor registers itself while it
 * has unsaved changes; the shell's navigation (sidebar, breadcrumb, page finder, account menu, sign out)
 * and the phone's back button ask before leaving: Save and leave, Discard changes, or Stay.
 */
export type Guard = {
  label: string;
  /** Saves everything currently in the editor. Resolves true only when nothing is left unsaved. */
  save: () => Promise<boolean>;
  discard: () => void;
  /** True while edits made after the last save are still unsaved (checked again after saving). */
  isDirty?: () => boolean;
};

let nextId = 0;
const guards = new Map<number, Guard>();

export function registerGuard(guard: Guard): () => void {
  const id = ++nextId;
  guards.set(id, guard);
  return () => { guards.delete(id); };
}

export const hasUnsavedWork = () => guards.size > 0;

/**
 * Resolves true when navigation may go ahead.
 * `leaving: "signOut"` words the choices for signing out, where saving afterwards is not possible.
 */
export async function confirmLeave(leaving: "navigate" | "signOut" = "navigate"): Promise<boolean> {
  const all = [...guards.values()];
  if (!all.length) return true;
  const guard = all[all.length - 1];
  const choice = leaving === "signOut"
    ? await choiceAsync("Save your changes before signing out?", `You have unsaved changes to ${guard.label}. Signing out without saving discards them.`,
        { confirm: "Save and sign out", extra: "Discard and sign out", cancel: "Stay signed in" })
    : await choiceAsync("Save your changes before leaving?", `You have unsaved changes to ${guard.label}. Leaving without saving discards them.`,
        { confirm: "Save and leave", extra: "Discard changes", cancel: "Stay" });
  if (choice === "cancel") return false;
  if (choice === "extra") { guard.discard(); return true; }
  try {
    const saved = await guard.save();
    if (!saved) return false;
  } catch (e) {
    // Say why nothing happened; the editor keeps the draft.
    await alertAsync("Your changes were not saved", `${errorMessage(e)} You are still on this page, and your changes are intact.`);
    return false;
  }
  // Anything typed while that save was running is still unsaved, so this is not a safe moment to leave.
  if (guard.isDirty?.()) {
    await alertAsync("Newer changes are still unsaved", "Your earlier changes were saved, but you typed more while that was happening. Save again, or choose Discard changes, before leaving.");
    return false;
  }
  return true;
}
