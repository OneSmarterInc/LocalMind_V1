import { confirmAsync } from '@/ui/Confirm';

/** The pop-ups on the offline AI setup screen and in Offline AI.
 *
 * These are LocalMind's own dialog (DialogHost), the same one every other
 * confirmation uses, so they look alike on the laptop, Android and iOS and are
 * never a browser or phone system prompt. */

/** Before continuing without the model. True: continue. False: stay and set it up. */
export function confirmContinueWithoutModel(downloading: boolean): Promise<boolean> {
  return downloading
    ? confirmAsync(
        'Continue while the model downloads?',
        'The download keeps going in the background. Until it finishes, writing lessons and quizzes and asking doubts will not work. Reading, quizzes and sync work as usual.',
        'Continue', 'Stay here', { tone: 'primary', icon: 'cloud-download-outline' })
    : confirmAsync(
        'Continue without offline AI?',
        'Reading, quizzes and sync work as usual. Writing lessons and quizzes and asking doubts will not work until you set up the AI model in Offline AI.',
        'Continue anyway', 'Set it up now', { tone: 'warning', icon: 'hardware-chip-outline' });
}

/** Before stopping a model download. True: stop it. */
export function confirmCancelDownload(): Promise<boolean> {
  return confirmAsync(
    'Stop the download?',
    'What has downloaded so far is kept. Download again later to continue from where it stopped.',
    'Stop download', 'Keep downloading', { tone: 'warning', icon: 'pause-circle-outline' });
}
