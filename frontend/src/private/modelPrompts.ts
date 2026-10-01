import { choiceAsync, confirmAsync } from '@/ui';
import { device } from './device';
import { MODEL, type ModelSpec } from './modelSpec';
import { modelSetup } from './modelSetup';

export type ModelChoices = { models: ModelSpec[]; recommended: string; memoryBytes?: number };

const gb = (n?: number) => n === undefined ? 'unknown' : `${(n / 1024 ** 3).toFixed(n < 1024 ** 3 ? 2 : 1)} GB`;

/** Ask where (computer: a folder or browser storage) and which model (phone:
 * recommended or the other), then start the app-wide download. Used by
 * Offline AI and by the required setup screen.
 * Resolves null when the person cancelled before the download started,
 * otherwise whether the model ended up downloaded and verified. */
export async function chooseAndDownload(choices: ModelChoices | null, onNote?: (note: string) => void): Promise<boolean | null> {
  const d = await device();
  const where = await d.storage?.().catch(() => null);
  // A model this size belongs somewhere the person can find it, back it up and
  // reuse. Ask for a folder before the download starts, rather than dropping
  // several gigabytes into the browser's private storage by default. Browser
  // storage is still offered, because choosing a folder needs Chrome or Edge
  // on a computer and is not available everywhere.
  const canChoose = !!d.chooseModelFolder && !!where?.canChooseFolder && where.location === 'browser';
  if (canChoose) {
    const picked = await choiceAsync(
      'Where should the model be saved?',
      `${MODEL.title}: approximately ${MODEL.downloadSize}. Saving to a folder on this computer lets you see the .gguf file in File Explorer or Finder, copy it to another machine and keep it when browser data is cleared. If you choose a folder, your browser opens its folder chooser and then asks you to allow access: choose Allow. Internet is used only for the download; your books and questions are never sent to the model publisher.`,
      { confirm: 'Choose a folder…', extra: 'Use browser storage', cancel: 'Cancel' });
    if (picked === 'cancel') return null;
    if (picked === 'confirm') {
      const chosen = await d.chooseModelFolder!(() => {}, new AbortController().signal);
      onNote?.(`Saving to your folder “${chosen.folderName ?? 'the folder you chose'}”.`);
    }
  }
  let modelId: string | undefined;
  if (!canChoose && choices) {
    // Phone: recommend by memory, but let the person pick the other model.
    // Mobile data is fine: the size is shown and the choice is theirs.
    const best = choices.models.find(m => m.id === choices.recommended) ?? choices.models[0];
    const other = choices.models.find(m => m.id !== best.id);
    const memory = choices.memoryBytes ? `This phone has about ${gb(choices.memoryBytes)} of memory. ` : '';
    const picked = await choiceAsync('Which local AI model?',
      `${memory}Recommended: ${best.title} (${best.downloadSize}). ${best.summary}${other ? `\n\nAlternative: ${other.title} (${other.downloadSize}). ${other.summary}` : ''}\n\nOn mobile data the download uses that much of your data allowance, so Wi-Fi is better if you have it. The download keeps going if you switch to another app, and continues where it stopped if the connection drops. Your books and questions are never sent to the model publisher.`,
      { confirm: 'Download recommended', extra: other ? `Download ${other.id === 'quality' ? 'better quality' : 'faster'} model` : 'Cancel', cancel: 'Cancel' });
    if (picked === 'cancel' || (picked === 'extra' && !other)) return null;
    modelId = picked === 'extra' ? other!.id : best.id;
  } else if (!canChoose && !(await confirmAsync('Download local AI?', `${MODEL.title}: approximately ${MODEL.downloadSize}. Internet is used only to download the model; on mobile data it uses that much of your data allowance, so Wi-Fi is better. It will run on this device; your books and questions are not sent to the model publisher.`, 'Download', 'Cancel'))) {
    return null;
  }
  return modelSetup.download(modelId);
}
