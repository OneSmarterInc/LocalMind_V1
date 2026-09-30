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

/** Before the browser's folder chooser. The chooser and its \"Allow\" box are
 *  the browser's own; this says what they are for. True: open the chooser. */
export function confirmChooseFolder(): Promise<boolean> {
  return confirmAsync(
    'Choose a folder for the AI model',
    'Your browser will open its folder chooser. Pick a folder you can find again, such as Documents. The browser then asks you to allow LocalMind to save files there: choose Allow.',
    'Choose a folder', 'Cancel', { tone: 'primary', icon: 'folder-open-outline' });
}

/** Before the browser asks again for access to the saved model folder. */
export function confirmFolderAccess(): Promise<boolean> {
  return confirmAsync(
    'Allow access to your model folder',
    'Your AI model is saved in a folder on this computer. The browser needs your permission again to read it, and will ask next: choose Allow.',
    'Continue', 'Not now', { tone: 'primary', icon: 'folder-open-outline' });
}

/** Before a browser that shows its own prompt is asked to protect saved data. */
export function confirmProtectStorage(): Promise<boolean> {
  return confirmAsync(
    'Keep your offline data safe?',
    'Your browser can protect LocalMind\u2019s saved books, lessons and model from automatic clean-up when the computer runs low on space. It will ask you next: choose Allow.',
    'Continue', 'Not now', { tone: 'primary', icon: 'shield-checkmark-outline' });
}
