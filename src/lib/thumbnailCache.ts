import { get, setMany, del, delMany, entries } from 'idb-keyval';

const SESSION_KEY = 'thumbnailSession';
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_BYTES = 32 * 1024 * 1024;
interface CacheEntry { dataUrl: string; timestamp: number; url?: string; session?: string; tabId?: number }
export interface Thumbnail { dataUrl: string; timestamp: number; previous: boolean }

export function canCaptureUrl(url: string): boolean {
  return /^(https?|file):\/\//i.test(url);
}

// Called only by the worker; session storage survives worker suspension, not browser restart.
export async function initializeThumbnailSession(): Promise<string> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  if (typeof stored[SESSION_KEY] === 'string') return stored[SESSION_KEY];
  const session = crypto.randomUUID();
  await chrome.storage.session.set({ [SESSION_KEY]: session });
  return session;
}

function tabKey(session: string, tabId: number) { return `mosaic:tab:${session}:${tabId}`; }
function urlKey(url: string) { return `mosaic:url:${url}`; }
function fresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry?.dataUrl && Number.isFinite(entry.timestamp) && Date.now() - entry.timestamp < MAX_AGE;
}

export async function getThumbnail(tabId: number, url: string): Promise<Thumbnail | null> {
  if (!canCaptureUrl(url)) return null;
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const session = stored[SESSION_KEY] as string | undefined;
  const exact = session ? await get<CacheEntry>(tabKey(session, tabId)) : undefined;
  if (fresh(exact) && exact.url === url) return { dataUrl: exact.dataUrl, timestamp: exact.timestamp, previous: false };
  // A previous-session URL image is a fallback, never another live tab's screenshot.
  const previous = await get<CacheEntry>(urlKey(url)) ?? await get<CacheEntry>(url);
  if (fresh(previous) && (!session || previous.session !== session)) {
    return { dataUrl: previous.dataUrl, timestamp: previous.timestamp, previous: true };
  }
  return null;
}

export async function storeThumbnail(session: string, tabId: number, url: string, dataUrl: string) {
  const entry: CacheEntry = { session, tabId, url, dataUrl, timestamp: Date.now() };
  await setMany([[tabKey(session, tabId), entry], [urlKey(url), entry]]);
}

export async function removeTabThumbnail(session: string, tabId: number) { await del(tabKey(session, tabId)); }

export async function pruneThumbnails(session: string) {
  const all = await entries<IDBValidKey, CacheEntry>();
  all.sort((a, b) => (b[1]?.timestamp ?? 0) - (a[1]?.timestamp ?? 0));
  let count = 0, bytes = 0;
  const expired: IDBValidKey[] = [];
  for (const [key, entry] of all) {
    const obsoleteTab = typeof key === 'string' && key.startsWith('mosaic:tab:') && entry?.session !== session;
    const size = (entry?.dataUrl?.length ?? 0) * 2;
    if (!fresh(entry) || obsoleteTab || count >= MAX_ENTRIES || bytes + size > MAX_BYTES) expired.push(key);
    else { count++; bytes += size; }
  }
  if (expired.length) await delMany(expired);
}

export async function resizeThumbnail(dataUrl: string): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const canvas = new OffscreenCanvas(640, 400), context = canvas.getContext('2d');
    if (!context) return dataUrl;
    const ratio = Math.max(640 / bitmap.width, 400 / bitmap.height);
    context.drawImage(bitmap, (640 - bitmap.width * ratio) / 2, 0, bitmap.width * ratio, bitmap.height * ratio);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    // Convert directly without depending on a DOM or FileReader instance.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } finally { bitmap.close(); }
}
