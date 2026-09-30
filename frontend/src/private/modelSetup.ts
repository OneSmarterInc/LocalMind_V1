import { useSyncExternalStore } from 'react';
import { backgroundWork } from './backgroundWork';
import { device } from './device';

/** The model download, owned by the app rather than by a screen.
 *
 * It used to run inside the Offline AI screen, which cancelled it when the
 * screen closed, so moving to another page (or the phone closing that screen
 * in the background) stopped it. Now only "Cancel download" stops it:
 *  - leaving the screen keeps it going, and any screen can show its progress;
 *  - on phones it runs under the same background session as generation
 *    (backgroundWork): an Android notification with progress, the iOS 26
 *    progress bar. iOS also downloads through a background URLSession.
 *  - in a browser the tab is marked busy and closing it asks first.
 * The required-setup screen (ModelGate) and Offline AI both use this. */
export type ModelSetupState = {
  running: boolean;
  /** 0–100 while running. */
  progress: number;
  error: string;
  /** Increases each time a download finishes successfully. */
  completed: number;
  /** Increases when the model was imported or removed elsewhere, so the
   * required-setup screen checks again. */
  changes: number;
};

let state: ModelSetupState = { running: false, progress: 0, error: '', completed: 0, changes: 0 };
let controller: AbortController | null = null;
let current: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<ModelSetupState>) {
  state = { ...state, ...next };
  for (const listener of [...listeners]) listener();
}

export const modelSetup = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  /** Start the download, or join the one already running. Resolves true once
   * the model is downloaded and verified, false if it failed or was cancelled. */
  download(modelId?: string): Promise<boolean> {
    if (current) return current;
    const abort = new AbortController();
    controller = abort;
    set({ running: true, progress: 0, error: '' });
    let lastShared = -1;
    const report = (p: number) => {
      const percent = Math.max(0, Math.min(100, Math.round(p * 100)));
      if (percent !== state.progress) set({ progress: percent });
      if (percent !== lastShared) { lastShared = percent; backgroundWork.progress(p, percent >= 98 ? 'Checking the download…' : `Downloading… ${percent}%`); }
    };
    current = (async () => {
      await backgroundWork.enter('Starting the download…', 'Downloading the AI model');
      try {
        await (await device()).download(report, abort.signal, modelId);
        set({ running: false, progress: 100, completed: state.completed + 1 });
        return true;
      } catch (e) {
        set({ running: false, error: e instanceof Error ? e.message : String(e) });
        return false;
      } finally {
        backgroundWork.leave();
        controller = null; current = null;
      }
    })();
    return current;
  },
  cancel() { controller?.abort(); },
  clearError() { if (state.error) set({ error: '' }); },
  /** The installed model changed (imported, removed, folder access granted). */
  changed() { set({ changes: state.changes + 1 }); },
};

export function useModelSetup(): ModelSetupState {
  return useSyncExternalStore(modelSetup.subscribe, modelSetup.get, modelSetup.get);
}
