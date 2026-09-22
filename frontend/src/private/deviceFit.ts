/**
 * Can this browser run the 1.1 GB offline model? Phones often cannot: the
 * browser reloads the tab when memory runs out, and older iPhone Safari lacks
 * the file-writing feature the model download uses. This check gives a clear
 * answer up front instead of a silent failure mid-download or mid-lesson.
 */
export type DeviceFit = { ok: true } | { ok: false; reason: string };

type Nav = { deviceMemory?: number; userAgent?: string; maxTouchPoints?: number };
type Win = { FileSystemFileHandle?: { prototype?: Record<string, unknown> } };

export function deviceFit(nav: Nav | undefined = (globalThis as { navigator?: Nav }).navigator, win: Win = globalThis as unknown as Win): DeviceFit {
  if (!nav) return { ok: true };
  const ua = nav.userAgent || '';
  const phone = /Android|iPhone|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1 && /iPad|Mobile/i.test(ua));
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory < 4)
    return { ok: false, reason: `This device reports about ${nav.deviceMemory} GB of memory. The offline AI needs at least 4 GB.` };
  const writable = !!win.FileSystemFileHandle?.prototype && 'createWritable' in (win.FileSystemFileHandle.prototype as object);
  if (/iPhone|iPad|iPod/i.test(ua) && !writable)
    return { ok: false, reason: 'This iPhone or iPad browser cannot save the model file. Update iOS, or use a computer.' };
  if (phone && typeof nav.deviceMemory !== 'number')
    return { ok: false, reason: 'Phone browsers often close the page while loading the 1.1 GB model.' };
  return { ok: true };
}
