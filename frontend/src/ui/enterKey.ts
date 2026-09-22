/**
 * "Enter sends, Shift+Enter starts a new line" for multi-line boxes such as
 * Ask a doubt. Only on the web: phone keyboards keep their own Return key.
 * Typing with an input method (Hindi, Marathi, Japanese...) is left alone
 * while a word is still being composed.
 */
type KeyEvent = { nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number }; preventDefault?: () => void; isDefaultPrevented?: () => boolean };

export function enterHandler<E>(onEnter: (() => void) | undefined, onKeyPress: ((e: E) => void) | undefined, isWeb: boolean): ((e: E) => void) | undefined {
  if (!onEnter || !isWeb) return onKeyPress;
  return (e: E) => {
    onKeyPress?.(e);
    const ev = e as unknown as KeyEvent;
    const n = ev.nativeEvent;
    if (n.key !== "Enter" || n.shiftKey || n.isComposing || n.keyCode === 229 || ev.isDefaultPrevented?.()) return;
    ev.preventDefault?.();
    onEnter();
  };
}
