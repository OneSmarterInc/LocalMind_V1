import { useEffect, useState } from "react";

/**
 * The settled value of a search box.
 *
 * Screens search as you type rather than on a button press, but feeding the
 * raw input straight into a query fires one request per keystroke: typing a
 * student's name sent eight searches and the answers could arrive out of
 * order, so the list briefly showed results for a prefix of what had been
 * typed. This holds the value back until typing pauses.
 *
 * Clearing the box settles immediately. Waiting there would leave the previous
 * results on screen for a moment after the field is visibly empty, which is
 * the thing that made the old picker look broken.
 */
export function useDebounced(value: string, delay = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const wait = value.trim() ? delay : 0;
    const timer = setTimeout(() => setSettled(value), wait);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
