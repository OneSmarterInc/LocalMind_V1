import type { BottomTabNavigatorProps } from '@react-navigation/bottom-tabs';

/** Expo emits stack actions for replace/dismissTo even inside a tab portal.
 * Translate those actions through the tab router, retaining replace/pop history
 * semantics so browser Back does not reopen a completed form or redirect loop.
 * Used with backBehavior="fullHistory" to retain per-visit query parameters.
 */
export const portalRouter: NonNullable<BottomTabNavigatorProps['UNSTABLE_router']> = original => ({
  getStateForAction(state, action, options) {
    if (action.type !== 'REPLACE' && action.type !== 'POP_TO') {
      return original.getStateForAction(state, action, options);
    }
    const payload = action.payload as { name?: string; params?: Record<string, unknown> } | undefined;
    if (!payload?.name || (action.target && action.target !== state.key)) return null;
    const next = original.getStateForAction(state, { ...action, type: 'NAVIGATE' }, options);
    if (!next || next.stale !== false) return next;
    const route = next.routes[next.index];
    let end = Math.max(0, state.history.length - 1);
    if (action.type === 'POP_TO') {
      // Match the requested context as well as the screen (e.g. a quiz's
      // Attempts tab, a specific book, or the Faculty people list).
      for (let i = state.history.length - 1; i >= 0; i--) {
        const item = state.history[i];
        const previous = state.routes.find(r => r.key === item.key);
        const params = item.params as Record<string, unknown> | undefined;
        if (previous?.name === payload.name && Object.entries(payload.params ?? {})
          .filter(([key]) => !key.startsWith('__'))
          .every(([key, value]) => JSON.stringify(params?.[key]) === JSON.stringify(value))) {
          end = i;
          break;
        }
      }
    }
    // Dynamic IDs can change a tab's key. History keeps each visit's params,
    // but must reference the current key for that screen to support GO_BACK.
    const history = state.history.slice(0, end).flatMap(item => {
      const previous = state.routes.find(r => r.key === item.key);
      const current = next.routes.find(r => r.name === previous?.name);
      return current ? [{ ...item, key: current.key }] : [];
    });
    return { ...next, history: [...history, { type: 'route', key: route.key, params: route.params }] };
  },
});
