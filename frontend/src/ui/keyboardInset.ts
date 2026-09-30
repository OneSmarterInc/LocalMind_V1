import React from "react";
import { Keyboard, KeyboardEvent, Platform, ScrollView, TextInput, View } from "react-native";

/**
 * How much of a scrolling page the on-screen keyboard actually covers.
 *
 * Android 15+ draws apps edge to edge, so `adjustResize` no longer shrinks the
 * window and the keyboard simply covers the bottom of the page. Older Android
 * versions still shrink the window. Measuring the overlap (rather than using the
 * keyboard height) gives the right answer in both cases, so the page is never
 * pushed up twice. The web build is unaffected.
 */
export function useKeyboardInset(target: React.RefObject<View | ScrollView | null>) {
  const [inset, setInset] = React.useState(0);
  const [keyboardTop, setKeyboardTop] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY;
      setKeyboardTop(top);
      const node = target.current as unknown as View | null;
      if (!node || typeof node.measureInWindow !== "function") { setInset(e.endCoordinates.height); return; }
      node.measureInWindow((_x, y, _w, h) => setInset(Math.max(0, Math.round(y + h - top))));
    };
    const onHide = () => { setInset(0); setKeyboardTop(null); };
    const a = Keyboard.addListener(showEvent, onShow);
    const b = Keyboard.addListener(hideEvent, onHide);
    return () => { a.remove(); b.remove(); };
  }, [target]);
  return { inset, keyboardTop };
}

/** True while the on-screen keyboard is open (native only). */
export function useKeyboardOpen() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (Platform.OS === "web") return;
    const a = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setOpen(true));
    const b = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setOpen(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return open;
}

/**
 * Scrolls `scroller` just enough that the focused text field sits above the
 * keyboard. Android's ScrollView does not do this on its own.
 */
export function revealFocusedInput(scroller: ScrollView | null, currentOffset: number, keyboardTop: number | null) {
  if (!scroller || keyboardTop == null || Platform.OS === "web") return;
  const focused = TextInput.State.currentlyFocusedInput?.() as unknown as View | null;
  if (!focused || typeof focused.measureInWindow !== "function") return;
  focused.measureInWindow((_x, y, _w, h) => {
    const margin = 24;
    const bottom = y + h + margin;
    if (bottom > keyboardTop) scroller.scrollTo({ y: currentOffset + (bottom - keyboardTop), animated: true });
    else if (y < 90) scroller.scrollTo({ y: Math.max(0, currentOffset - (90 - y)), animated: true });
  });
}

/* Fields announce focus so the page can reveal the next field while the keyboard stays open. */
const focusListeners = new Set<() => void>();
export function announceInputFocus() { setTimeout(() => focusListeners.forEach((fn) => fn()), 60); }
export function useInputFocus(fn: () => void) {
  const ref = React.useRef(fn);
  ref.current = fn;
  React.useEffect(() => { const l = () => ref.current(); focusListeners.add(l); return () => { focusListeners.delete(l); }; }, []);
}
