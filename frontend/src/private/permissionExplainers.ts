import AsyncStorage from '@react-native-async-storage/async-storage';
import { confirmAsync } from '@/ui/Confirm';
import { setNotificationExplainer } from './backgroundWork';

/** LocalMind's own pop-ups in front of the phone's permission prompts.
 *
 * Imported once by the root layout. Android's \"Allow notifications?\" is a
 * system prompt no app can restyle or replace, so the most an app can do is
 * explain first, in its own pop-up, and let the person decline before the
 * system asks. The answer is remembered on this device: after \"Not now\" the
 * system prompt is not shown again; notifications can still be turned on in
 * the phone's own settings for LocalMind. */
const KEY = 'localmind:notifications-explained';

export async function explainNotifications(store: Pick<typeof AsyncStorage, 'getItem' | 'setItem'> = AsyncStorage): Promise<boolean> {
  const earlier = await store.getItem(KEY).catch(() => null);
  if (earlier === 'declined') return false;
  if (earlier === 'accepted') return true;
  const yes = await confirmAsync(
    'Show progress in a notification?',
    'While LocalMind writes lessons, quizzes and answers, it can show progress in a notification, so the work keeps going when you switch apps. Android will ask you to allow notifications next.',
    'Continue', 'Not now', { tone: 'primary', icon: 'notifications-outline' });
  await store.setItem(KEY, yes ? 'accepted' : 'declined').catch(() => {});
  return yes;
}

setNotificationExplainer(() => explainNotifications());
