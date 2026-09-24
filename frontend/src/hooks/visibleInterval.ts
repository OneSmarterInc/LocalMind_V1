/**
 * setInterval for screens that only *display* polled state.
 *
 * While a browser tab is hidden the tick is skipped, so a book or quiz page
 * left open in a background tab stops scanning the device store and calling
 * the server. The moment the tab is visible again the tick runs once, so the
 * screen is current without waiting for the next interval.
 *
 * On iOS/Android there is no `document`: this behaves exactly like
 * setInterval. Never use it for work that must keep running in the
 * background (the quiz deadline timer, generation jobs themselves).
 */
export function everyVisible(tick: () => unknown, ms: number): () => void {
  const doc = typeof document !== "undefined" && typeof document.addEventListener === "function" ? document : undefined;
  const run = () => { void tick(); };
  const timer = setInterval(() => { if (!doc || doc.visibilityState !== "hidden") run(); }, ms);
  const onVisible = () => { if (doc?.visibilityState === "visible") run(); };
  doc?.addEventListener("visibilitychange", onVisible);
  return () => { clearInterval(timer); doc?.removeEventListener("visibilitychange", onVisible); };
}
