/**
 * The ship kit's one Share, on a desktop (`share.ts` is the phone's).
 *
 * The phone's path puts the files in the app's cache directory and hands them to the share sheet.
 * A page has neither: FOUND IN THE DESKTOP PARITY PASS, Share threw "no cache directory" before it
 * did anything. So here the picked files come down into memory (with the bearer, as on the phone)
 * and go to the shell, which writes them into one new folder in Downloads and shows it in Finder
 * or Explorer (`desktop/src/image.js` `kitFiles`: the four kit types, checked by their bytes). The
 * words go on the clipboard, as the phone's native path also does, because posting from a desktop
 * is dragging the files into the site and pasting the caption. In a plain browser each file
 * downloads.
 */
import { api } from '../data/client';
import { desktopBridge } from '../desktop/bridge';
import { copyText } from '../onboarding/clipboard';
import type { ShareFile, SharePayload } from './model';

export interface ShareOutcome {
  shared: boolean | null;
  line: string;
}

/** The phone keeps the files in its cache; a desktop has none to keep them in. */
export async function fetchFiles(_files: readonly ShareFile[]): Promise<string[]> {
  return [];
}

async function bytesOf(f: ShareFile): Promise<Uint8Array> {
  const src = await api.mediaSource(f.url);
  const r = await fetch(src.uri, { headers: src.headers });
  if (!r.ok) throw new Error(`${f.name} did not come down (the server answered ${r.status}).`);
  return new Uint8Array(await r.arrayBuffer());
}

function counted(n: number): string {
  return n === 1 ? 'the file' : `${n} files`;
}

export async function shareSelection(p: SharePayload): Promise<ShareOutcome> {
  const files = await Promise.all(p.files.map(async (f) => ({ name: f.name, bytes: await bytesOf(f) })));
  const copied = p.text ? copyText(p.text) : false;
  const words = copied ? ' The words are copied, to paste into the post.' : '';
  const bridge = desktopBridge();
  if (bridge?.saveFiles) {
    const dir = await bridge.saveFiles(files, 'Builda kit');
    return dir ? { shared: true, line: `Saved ${counted(files.length)} to a folder in Downloads.${words}` } : { shared: false, line: 'Those files could not be saved.' };
  }
  for (const f of files) {
    const url = URL.createObjectURL(new Blob([f.bytes as BlobPart]));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return { shared: true, line: `Downloaded ${counted(files.length)}.${words}` };
}
