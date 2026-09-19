import { Platform } from 'react-native';
/** Arrows move focus; Enter/Space activate the focused item. */
export function keyboardList(role: 'tab' | 'radio' | 'menuitem', close?: () => void) {
  if (Platform.OS !== 'web') return {};
  return { onKeyDown: (event: { key: string; preventDefault(): void; currentTarget: HTMLElement; target: EventTarget | null }) => {
    if (event.key === 'Escape' && close) { event.preventDefault(); close(); return; }
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    if (!direction && !['Home', 'End'].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`));
    if (!items.length) return;
    const current = items.findIndex(item => item === event.target || item.contains(event.target as Node));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + direction + items.length) % items.length;
    event.preventDefault(); items[next].focus();
  } };
}
