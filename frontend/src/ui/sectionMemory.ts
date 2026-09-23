/** Where the person was last working inside each sidebar section.
 *
 * Every screen in a portal is a sibling tab, so pressing "Books & modules"
 * navigated to the books list even when the person had a book open and had
 * only stepped away to look at Quizzes. Detail screens declare which section
 * they belong to (``shellScreen``'s ``section`` option, which also drives the
 * sidebar highlight); this records the last route visited under each one so
 * the sidebar can return there instead of resetting to the list.
 *
 * Screens stay mounted inside the tab navigator, so navigating back to the
 * same route and params restores the outline selection, the open tab and the
 * scroll position without any extra work.
 *
 * In memory only, and per portal, so the faculty workspace and the
 * administrator workspace do not read each other's positions. Cleared on sign
 * out with the rest of the account's state.
 */
export type SectionPosition = { name: string; params?: object };

const positions = new Map<string, SectionPosition>();
const at = (portal: string, section: string) => `${portal}|${section}`;

/** Remember that ``name`` (with ``params``) is the current page of ``section``. */
export function rememberSection(portal: string, section: string, name: string, params?: object) {
  if (!portal || !section || !name || name === section) return;
  positions.set(at(portal, section), { name, params });
}

/** The page to reopen for ``section``, or undefined to use the section itself. */
export function recallSection(portal: string, section: string): SectionPosition | undefined {
  return positions.get(at(portal, section));
}

/** Pressing a section the person is already inside goes back to its list. */
export function forgetSection(portal: string, section: string) {
  positions.delete(at(portal, section));
}

export function clearSectionMemory() {
  positions.clear();
}
