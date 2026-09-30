/** "Set up later" for the offline AI model, remembered per person per device.
 *
 * The required-setup screen (ModelGate) used to let only a computer that
 * cannot run the model continue without it. Everyone else, on the laptop,
 * Android and iOS, could only download, import, or sign out, so a phone with
 * too little storage, a slow connection, or an administrator who never uses
 * AI was stuck on that screen. Reading, quizzes and synchronizing never needed
 * the model; only writing lessons and quizzes and answering doubts do, and
 * those already say "Download or import a model in Offline AI first."
 *
 * The choice is kept on this device for this account, so the screen is not
 * shown again on every start. Installing a model clears it, so removing the
 * model later asks again. The storage is passed in (AsyncStorage in the app)
 * so this can be tested without a device.
 */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const PREFIX = 'localmind:model-setup-later:';

export const skipKey = (userId: string) => `${PREFIX}${userId}`;

/** Whether this person chose to continue without the model on this device.
 *  An unreadable store counts as "not chosen": the setup screen is offered. */
export async function setupPutOff(store: KeyValueStore, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  try { return (await store.getItem(skipKey(userId))) === '1'; } catch { return false; }
}

/** Remember the choice. A store that cannot be written still lets them
 *  continue for now; they are simply asked again on the next start. */
export async function putOffSetup(store: KeyValueStore, userId: string | undefined): Promise<void> {
  if (!userId) return;
  await store.setItem(skipKey(userId), '1').catch(() => {});
}

/** A model is on this device now: forget the choice. */
export async function clearPutOff(store: KeyValueStore, userId: string | undefined): Promise<void> {
  if (!userId) return;
  await store.removeItem(skipKey(userId)).catch(() => {});
}

/** The reminder shown once per app start while the model is not set up. */
export const SETUP_REMINDER = {
  tone: 'info' as const,
  title: 'Offline AI is not set up on this device',
  message: 'Reading, quizzes and sync work as usual. To write lessons and quizzes or ask a doubt, set up the model in Offline AI.',
};
