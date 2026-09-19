/**
 * One Share, every file picked (docs/ship-kit.md): the files come down into the app's cache under
 * the names they should arrive with, then ONE native share sheet carries all of them and the
 * caption (`BuilderDrops.shareItems`, UIActivityViewController). expo-sharing takes one file, so it
 * is the fallback only: a build without the native module shares the first file and says so,
 * rather than sharing half a post and saying nothing.
 *
 * The caption goes on the pasteboard in the native path too (the module does it), because some
 * apps take the files and drop the words; the screen says "the words are copied" after a share.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import BuilderDrops from '../../modules/builder-drops';
import { api } from '../data/client';
import { copyText } from '../onboarding/clipboard';
import { fallbackLine, type ShareFile, type SharePayload } from './model';

export interface ShareOutcome {
  /** Null when the sheet cannot say (expo-sharing resolves alike for sent and closed). */
  shared: boolean | null;
  /** What the screen says after. */
  line: string;
}

/** Where a kit file is kept on the phone: its id's folder, its own name, so a re-share is instant. */
function localPath(f: ShareFile): string | null {
  const base = FileSystem.cacheDirectory;
  return base ? `${base}shipkit/${f.id}/${f.name}` : null;
}

/** Every file of the payload on disk, downloaded once (with the bearer on the local stack). */
export async function fetchFiles(files: readonly ShareFile[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    const dest = localPath(f);
    if (!dest) throw new Error('This phone has no cache directory to put the files in.');
    const have = await FileSystem.getInfoAsync(dest);
    if (!have.exists) {
      await FileSystem.makeDirectoryAsync(dest.slice(0, dest.lastIndexOf('/')), { intermediates: true });
      const src = await api.mediaSource(f.url);
      const got = await FileSystem.downloadAsync(src.uri, dest, { headers: src.headers });
      if (got.status < 200 || got.status >= 300) {
        await FileSystem.deleteAsync(dest, { idempotent: true });
        throw new Error(`${f.name} did not come down (the server answered ${got.status}).`);
      }
    }
    out.push(dest);
  }
  return out;
}

export async function shareSelection(p: SharePayload): Promise<ShareOutcome> {
  const paths = await fetchFiles(p.files);
  if (BuilderDrops?.shareItems) {
    const r = await BuilderDrops.shareItems(paths, p.text || null);
    if (!r.shared) return { shared: false, line: r.missing ? `${r.missing} file(s) were not on the phone, so the sheet did not offer them.` : 'Not shared.' };
    return { shared: true, line: p.text ? 'Shared. The words are copied too, for an app that dropped them.' : 'Shared.' };
  }
  if (!(await Sharing.isAvailableAsync())) return { shared: false, line: 'Sharing is not available on this device.' };
  const first = p.files[0]!;
  // The words first, so they are on the pasteboard while the sheet is up: this sheet has no text.
  const copied = p.text ? copyText(p.text) : false;
  await Sharing.shareAsync(paths[0]!, { mimeType: first.contentType, dialogTitle: p.text || undefined });
  return { shared: null, line: fallbackLine(p.files.length, first.name, copied) };
}
