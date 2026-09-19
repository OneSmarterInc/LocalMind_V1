import { backToKnownWebParent, parentHref } from "./webHistory";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { confirmLeave } from "./unsavedGuard";

/**
 * One rule for every "up one level" control: the breadcrumb in the shell header and
 * the "Back to X" button inside a page must do the same thing.
 *
 * PortalTabs adapts dismissTo to tab history (stock Expo Tabs does not).
 * Dismiss to an existing parent when it is in the stack; otherwise replace
 * the current route for direct-entry links.
 *
 * Unsaved work is still asked about first (Save / Discard / Stay).
 */
export function useBackTo() {
  const router = useRouter();
  return useCallback(
    (to: string | { pathname: string; params?: Record<string, unknown> }) => {
      void confirmLeave().then((ok) => {
        if (ok && !backToKnownWebParent(parentHref(to))) router.dismissTo(to as never);
      });
    },
    [router],
  );
}
