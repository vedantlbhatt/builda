/**
 * A shared link, normalised. PURE: no React Native, no network, so `bun test` can hold it
 * against the Python it ports (`__tests__/dropsUrls.test.ts` runs both over the same cases).
 *
 * NORMALISATION IS THE CLIENT'S AND VALIDATION IS THE SERVER'S. The server checks the SHAPE of
 * what arrives rather than rewriting it, so there are never two normalisers disagreeing about
 * what one reel's link is. The rules, and the measurements behind them, are in `drops/urls.py`:
 * in particular `www.` is not noise, and removing it turns a working TikTok link into one
 * TikTok's own oEmbed endpoint answers 400 for.
 */
/** Same list, same order, as `drops/urls.py` HOSTS. */
const HOSTS: [string, string][] = [
  ['instagram.com', 'instagram'],
  ['instagr.am', 'instagram'],
  ['tiktok.com', 'tiktok'],
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['twitter.com', 'x'],
  ['x.com', 'x'],
  ['reddit.com', 'reddit'],
  ['redd.it', 'reddit'],
  ['threads.net', 'threads'],
  ['threads.com', 'threads'],
];

/** Same table as `drops/urls.py` CANONICAL_HOST, and for the same measured reason: dropping
 * `www.` turns a working TikTok link into one TikTok's own oEmbed answers 400 for. */
const CANONICAL: Record<string, string> = {
  'instagram.com': 'www.instagram.com',
  'tiktok.com': 'www.tiktok.com',
  'youtube.com': 'www.youtube.com',
  'twitter.com': 'x.com',
  'x.com': 'x.com',
  'reddit.com': 'www.reddit.com',
  'threads.net': 'www.threads.com',
  'threads.com': 'www.threads.com',
};

/** Same set as `drops/urls.py` SHARE_PARAMS: the sharer's id, not the post's. */
const SHARE_PARAMS = new Set([
  'igsh', 'igshid', '_t', '_r', '_d', 'si', 's', 't', 'share_id', 'context',
  'fbclid', 'gclid', 'feature', 'app', 'is_from_webapp', 'sender_device',
]);

export const MAX_URL = 500;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'\])]+/i;

export interface Shared {
  url: string;
  platform: string;
  text: string;
}

/** The host a person would say for a link: "youtube.com", never "www.youtube.com". */
export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/.exec(url);
  return (m?.[1] ?? url).replace(/^www\./, '');
}

export function platformOf(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/^m\./, '').replace(/^vm\./, '');
  for (const [suffix, name] of HOSTS) {
    if (h === suffix || h.endsWith('.' + suffix)) return name;
  }
  return 'web';
}

/**
 * A share sheet's payload as {url, platform, text}, or null when there is no link in it.
 *
 * Never throws: a share that cannot be read has to come back as "no link in that" on the sheet,
 * not as an exception inside a foreground handler nobody is watching.
 */
export function normalizeShared(payload: string): Shared | null {
  const raw = (payload ?? '').trim();
  if (!raw) return null;
  const found = URL_IN_TEXT.exec(raw)?.[0]?.replace(/[.,;:]+$/, '');
  const candidate = found ?? (raw.includes('://') ? raw : `https://${raw}`);
  if (candidate.length > MAX_URL) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  // `https://evil.com@instagram.com/` reads as one host and resolves to another.
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (!host.includes('.')) return null;

  const platform = platformOf(host);
  const bare = host.replace(/^www\./, '').replace(/^m\./, '');
  const finalHost = CANONICAL[bare] ?? host;

  const keep: [string, string][] = [];
  parsed.searchParams.forEach((v, k) => {
    if (!SHARE_PARAMS.has(k) && !k.startsWith('utm_') && v !== '') keep.push([k, v]);
  });
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const qs = keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const port = parsed.port && parsed.port !== '80' && parsed.port !== '443' ? `:${parsed.port}` : '';

  const text = found ? raw.replace(found, ' ').trim().replace(/\s+/g, ' ') : '';
  return { url: `https://${finalHost}${port}${path}${qs ? `?${qs}` : ''}`, platform, text };
}

