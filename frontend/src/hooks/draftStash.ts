/** Session-only recovery; never carry drafts across account changes. */
export const draftStash = new Map<string, { draft: unknown; label: string }>();
let epoch = 0;
export const draftEpoch = () => epoch;
export function clearDraftStash() { epoch++; draftStash.clear(); }
