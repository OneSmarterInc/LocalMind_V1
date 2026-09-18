import { useRouter } from "expo-router";
import { useCallback } from "react";
import { confirmLeave } from "./unsavedGuard";

/**
 * One rule for every "up one level" control: the breadcrumb in the shell header and
 * the "Back to X" button inside a page must do the same thing.
 *
 * It replaces the current entry rather than pushing a new one. Pushing made the
 * history grow every time someone went list -> detail -> back, so the browser's Back
 * button returned to the detail page they had just left. Replacing keeps the history
 * length constant and makes Back mean "up another level", which is what the arrow
 * in the label promises.
 *
 * Unsaved work is still asked about first (Save / Discard / Stay).
 */
export function useBackTo() {
  const router = useRouter();
  return useCallback(
    (to: string | { pathname: string; params?: Record<string, unknown> }) => {
      void confirmLeave().then((ok) => {
        if (ok) router.replace(to as never);
      });
    },
    [router],
  );
}
