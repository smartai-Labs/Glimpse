import { get, setMany, del, delMany, entries } from 'idb-keyval';
import { cacheHost } from './previewSettings';

const SESSION_KEY = 'thumbnailSession';
const IMAGE_PREFIX = 'glimpse:image:';
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_BYTES = 32 * 1024 * 1024;
interface CacheEntry { dataUrl?: string; imageId?: string; timestamp: number; url?: string; session?: string; tabId?: number }
interface ImageEntry { blob: Blob; timestamp: number }
export interface Thumbnail { dataUrl: string; timestamp: number; previous: boolean }
export interface CacheStats { bytes: number; images: number; limit: number; sites: { host: string; bytes: number; images: number }[] }

// Production mutations run in the worker only. Serializing also covers async legacy conversion.
let writes = Promise.resolve();
function mutate<T>(task: () => Promise<T>): Promise<T> {
  const result = writes.then(task); writes = result.then(() => {}, () => {}); return result;
}
export function canCaptureUrl(url: string): boolean { return /^(https?|file):\/\//i.test(url); }
export async function initializeThumbnailSession(): Promise<string> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  if (typeof stored[SESSION_KEY] === 'string') return stored[SESSION_KEY];
  const session = crypto.randomUUID(); await chrome.storage.session.set({ [SESSION_KEY]: session }); return session;
}
function tabKey(session: string, tabId: number) { return 'mosaic:tab:' + session + ':' + tabId; }
function urlKey(url: string) { return 'mosaic:url:' + url; }
function fresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!(entry?.imageId || entry?.dataUrl) && Number.isFinite(entry.timestamp) && Date.now() - entry.timestamp < MAX_AGE;
}
function isImage(key: IDBValidKey): boolean { return typeof key === 'string' && key.startsWith(IMAGE_PREFIX); }
function isIndex(key: IDBValidKey): boolean { return typeof key === 'string' && (key.startsWith('mosaic:') || canCaptureUrl(key)); }
function entryUrl(key: IDBValidKey, entry: CacheEntry): string {
  return entry.url ?? (typeof key === 'string' ? key.startsWith('mosaic:url:') ? key.slice(11) : canCaptureUrl(key) ? key : '' : '');
}
function indexBytes(key: IDBValidKey, entry: CacheEntry) { return new TextEncoder().encode(String(key) + JSON.stringify(entry)).length; }
async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(binary);
}
async function readImage(entry: CacheEntry): Promise<string | null> {
  if (entry.dataUrl) return entry.dataUrl;
  const image = entry.imageId ? await get<ImageEntry>(entry.imageId) : null;
  return image?.blob instanceof Blob ? blobDataUrl(image.blob) : null;
}
export async function getThumbnail(tabId: number, url: string): Promise<Thumbnail | null> {
  if (!canCaptureUrl(url)) return null;
  const stored = await chrome.storage.session.get(SESSION_KEY), session = stored[SESSION_KEY] as string | undefined;
  const exact = session ? await get<CacheEntry>(tabKey(session, tabId)) : undefined;
  if (fresh(exact) && exact.url === url) {
    const dataUrl = await readImage(exact); if (dataUrl) return { dataUrl, timestamp: exact.timestamp, previous: false };
  }
  const previous = await get<CacheEntry>(urlKey(url)) ?? await get<CacheEntry>(url);
  // Same-URL tabs in the current session never borrow one another's image.
  if (fresh(previous) && (!session || previous.session !== session)) {
    const dataUrl = await readImage(previous); if (dataUrl) return { dataUrl, timestamp: previous.timestamp, previous: true };
  }
  return null;
}
export function storeThumbnail(session: string, tabId: number, url: string, dataUrl: string) {
  return mutate(async () => {
    if (!canCaptureUrl(url) || !dataUrl.startsWith('data:image/')) throw new Error('Invalid thumbnail');
    const blob = await (await fetch(dataUrl)).blob(), timestamp = Date.now(), imageId = IMAGE_PREFIX + crypto.randomUUID();
    const entry: CacheEntry = { imageId, session, tabId, url, timestamp };
    // Image and both references commit together. Never remove the old image first.
    await setMany([[imageId, { blob, timestamp }], [tabKey(session, tabId), entry], [urlKey(url), entry]]);
    await pruneCache(session);
  });
}
export function removeTabThumbnail(session: string, tabId: number) { return mutate(() => del(tabKey(session, tabId))); }

/** Bounded, atomic per-capture conversion; any failed write leaves legacy records readable. */
async function migrateLegacy() {
  const all = await entries<IDBValidKey, CacheEntry>();
  const legacy = all.filter(([key, entry]) => isIndex(key) && fresh(entry) && entry.dataUrl?.startsWith('data:image/'));
  const migrated = new Set<IDBValidKey>(); let count = 0;
  for (const [key, entry] of legacy) {
    if (migrated.has(key) || count >= 24) continue;
    const peers = legacy.filter(([, other]) => other.dataUrl === entry.dataUrl && other.timestamp === entry.timestamp && other.session === entry.session && other.tabId === entry.tabId);
    try {
      const blob = await (await fetch(entry.dataUrl!)).blob(), imageId = IMAGE_PREFIX + crypto.randomUUID();
      const records: [IDBValidKey, unknown][] = [[imageId, { blob, timestamp: entry.timestamp }]];
      for (const [peerKey, peer] of peers) {
        const reference: CacheEntry = { imageId, timestamp: peer.timestamp, url: entryUrl(peerKey, peer), session: peer.session, tabId: peer.tabId };
        records.push([peerKey, reference]);
      }
      await setMany(records); peers.forEach(([peerKey]) => migrated.add(peerKey)); count++;
    } catch { /* Quota, corruption or interruption: keep the original record for fallback. */ }
  }
}
async function pruneCache(session: string) {
  const all = await entries<IDBValidKey, CacheEntry & Partial<ImageEntry>>();
  const images = new Map(all.filter(([key]) => isImage(key))), remove = new Set<IDBValidKey>();
  const groups = new Map<IDBValidKey, { keys: IDBValidKey[]; bytes: number; timestamp: number; live: boolean }>();
  for (const [key, entry] of all) {
    if (!isIndex(key)) continue;
    const obsolete = String(key).startsWith('mosaic:tab:') && entry?.session !== session;
    if (!fresh(entry) || obsolete) { remove.add(key); continue; }
    const image = entry.imageId ? images.get(entry.imageId) : null;
    if (entry.imageId && !(image?.blob instanceof Blob)) { remove.add(key); continue; }
    const id = entry.imageId || key;
    const group = groups.get(id) ?? { keys: [], bytes: image?.blob?.size ?? 0, timestamp: entry.timestamp, live: false };
    group.keys.push(key); group.bytes += indexBytes(key, entry);
    group.live ||= String(key).startsWith('mosaic:tab:') && entry.session === session;
    groups.set(id, group);
  }
  let count = 0, bytes = 0; const keepImages = new Set<IDBValidKey>();
  for (const [id, group] of [...groups].sort((a, b) => Number(b[1].live) - Number(a[1].live) || b[1].timestamp - a[1].timestamp)) {
    if (count >= MAX_ENTRIES || bytes + group.bytes > MAX_BYTES) group.keys.forEach(key => remove.add(key));
    else { count++; bytes += group.bytes; keepImages.add(id); }
  }
  for (const key of images.keys()) if (!keepImages.has(key)) remove.add(key);
  if (remove.size) await delMany([...remove]);
}
export function pruneThumbnails(session: string) { return mutate(async () => { await migrateLegacy(); await pruneCache(session); }); }
export function clearThumbnails(host?: string) {
  return mutate(async () => {
    const all = await entries<IDBValidKey, CacheEntry>(); const remove = new Set<IDBValidKey>();
    for (const [key, entry] of all) if (isIndex(key) && (!host || cacheHost(entryUrl(key, entry)) === host)) remove.add(key);
    const retained = new Set(all.filter(([key]) => isIndex(key) && !remove.has(key)).map(([, entry]) => entry.imageId));
    for (const [key] of all) if (isImage(key) && !retained.has(String(key))) remove.add(key);
    if (remove.size) await delMany([...remove]);
  });
}
export async function getCacheStats(): Promise<CacheStats> {
  await writes;
  const all = await entries<IDBValidKey, CacheEntry & Partial<ImageEntry>>();
  const images = new Map(all.filter(([key]) => isImage(key))), counted = new Set<string>();
  const sites = new Map<string, { host: string; bytes: number; images: number }>(); let bytes = 0;
  for (const [, entry] of images) bytes += entry.blob?.size ?? 0;
  for (const [key, entry] of all) {
    if (!isIndex(key)) continue;
    const host = cacheHost(entryUrl(key, entry)) || '其他页面', site = sites.get(host) ?? { host, bytes: 0, images: 0 };
    const size = indexBytes(key, entry); bytes += size; site.bytes += size;
    const id = entry.imageId || String(key);
    if (!counted.has(id)) { counted.add(id); site.images++; site.bytes += entry.imageId ? images.get(entry.imageId)?.blob?.size ?? 0 : 0; }
    sites.set(host, site);
  }
  return { bytes, images: counted.size, limit: MAX_BYTES, sites: [...sites.values()].sort((a, b) => b.bytes - a.bytes) };
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
