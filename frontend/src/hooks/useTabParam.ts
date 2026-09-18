import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

/**
 * Keeps a page's selected tab in the address bar.
 *
 * Before this, the tab lived only in component state: reloading the page or sharing the
 * link dropped the reader back on the first tab, and a link that arrived with ?tab=... was
 * honoured once and then forgotten. The tab is written with setParams, which rewrites the
 * current history entry rather than adding one, so switching tabs does not fill the
 * browser's Back button with tab changes.
 */
export function useTabParam<T extends string>(fallback: T, valid: readonly T[]) {
  const params = useLocalSearchParams<{ tab?: string }>();
  const router = useRouter();
  const fromUrl = valid.includes(params.tab as T) ? (params.tab as T) : null;
  const [tab, setTabState] = useState<T>(fromUrl ?? fallback);

  // A link that arrives with a different tab (or a Back that restores one) wins.
  useEffect(() => {
    if (fromUrl && fromUrl !== tab) setTabState(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const setTab = useCallback(
    (next: T) => {
      setTabState(next);
      router.setParams({ tab: next } as never);
    },
    [router],
  );

  return [tab, setTab] as const;
}
