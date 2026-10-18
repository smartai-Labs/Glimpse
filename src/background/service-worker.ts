import { canCaptureUrl, initializeThumbnailSession, storeThumbnail, removeTabThumbnail, pruneThumbnails, resizeThumbnail, clearThumbnails, getCacheStats } from '../lib/thumbnailCache';
import { PREVIEW_STATE_PREFIX, isPreviewState } from '../lib/previewState';
import type { PreviewState } from '../lib/previewState';
import { CaptureQueue } from './captureQueue';
import { PREVIEW_SETTINGS_KEY, DEFAULT_PREVIEW_SETTINGS, readPreviewSettings, normalizePreviewSettings, excludedUrl } from '../lib/previewSettings';
import type { PreviewSettings } from '../lib/previewSettings';
let preferences: PreviewSettings = { ...DEFAULT_PREVIEW_SETTINGS, paused: true };
let captureEpoch = 0, controlBusy = false;
const preferencesReady = readPreviewSettings().then(value => { preferences = value; });
let controls = Promise.resolve();

const ALARM = 'mosaic-thumbnail-refresh';
const INTERVAL = 650;
const MIN_TAB_INTERVAL = 3000;
const STALE_AFTER = 5 * 60 * 1000;
const sessionReady = initializeThumbnailSession();
const states = new Map<number, PreviewState>();
const stateReady = chrome.storage.session.get(null).then(values => {
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(PREVIEW_STATE_PREFIX) && isPreviewState(value)) states.set(Number(key.slice(PREVIEW_STATE_PREFIX.length)), value);
  }
}).catch(() => {});
let stateWrites = Promise.resolve();
const windowRevisions = new Map<number, number>();
const tabRevisions = new Map<number, number>();
let lastToggleTime = 0, lastPruneTime = 0, lastCaptureTime = 0;

function saveState(tabId: number, state: PreviewState | null) {
  const key = `${PREVIEW_STATE_PREFIX}${tabId}`;
  if (state) states.set(tabId, state); else states.delete(tabId);
  // Serialize updates so a slow write cannot overwrite a navigation or removal.
  stateWrites = stateWrites.then(() => state ? chrome.storage.session.set({ [key]: state }) : chrome.storage.session.remove(key)).catch(() => {});
  return stateWrites;
}
function stateFor(tab: chrome.tabs.Tab): PreviewState {
  const state = states.get(tab.id!);
  return state && state.url === tab.url ? state : { url: tab.url!, status: 'ready', capturedAt: 0, dirtyAt: Date.now(), failures: 0, blockedUntil: 0 };
}
function eligible(tab: chrome.tabs.Tab): boolean {
  return tab.id !== undefined && tab.active && !tab.incognito && !tab.discarded && tab.status !== 'loading' && !controlBusy && !preferences.paused && !excludedUrl(tab.url ?? '', preferences) && canCaptureUrl(tab.url ?? '');
}
function sameTab(tab: chrome.tabs.Tab, original: chrome.tabs.Tab): boolean {
  return eligible(tab) && tab.id === original.id && tab.url === original.url && tab.windowId === original.windowId;
}
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const notify = (type: string, tabId: number, url: string) => chrome.runtime.sendMessage({ type, tabId, url }).catch(() => {});

async function markDirty(tabId: number, delay = 450) {
  await Promise.all([stateReady, preferencesReady]);
  const tab = await chrome.tabs.get(tabId);
  if (tab.incognito || preferences.paused || excludedUrl(tab.url ?? '', preferences) || !canCaptureUrl(tab.url ?? '')) return;
  const state = stateFor(tab);
  if (state.dirtyAt < Date.now() || !states.has(tabId) || states.get(tabId)?.url !== tab.url) {
    await saveState(tabId, { ...state, dirtyAt: Math.max(Date.now(), state.capturedAt + 1) });
  }
  if (eligible(tab)) queue.schedule(tabId, delay);
}

const queue = new CaptureQueue(async tabId => {
  let tab: chrome.tabs.Tab | undefined, windowVersion: number | undefined, tabVersion: number | undefined;
  try {
    const [session] = await Promise.all([sessionReady, stateReady, preferencesReady]);
    const epoch = captureEpoch;
    tab = await chrome.tabs.get(tabId);
    if (!eligible(tab) || epoch !== captureEpoch) return 'skip';
    const window = await chrome.windows.get(tab.windowId);
    if (window.state === 'minimized' || window.type !== 'normal') return 'skip';
    const state = stateFor(tab), now = Date.now();
    if (state.blockedUntil > now) return 'skip';
    if (state.status === 'ready' && state.capturedAt && state.dirtyAt <= state.capturedAt && now - state.capturedAt < STALE_AFTER) return 'skip';
    if (state.capturedAt && now - state.capturedAt < MIN_TAB_INTERVAL) {
      queue.schedule(tabId, MIN_TAB_INTERVAL - (now - state.capturedAt));
      return 'skip';
    }
    const stored = await chrome.storage.session.get('lastThumbnailCapture');
    const last = Math.max(lastCaptureTime, typeof stored.lastThumbnailCapture === 'number' ? stored.lastThumbnailCapture : 0);
    await wait(Math.max(0, INTERVAL - (Date.now() - last)));
    tab = await chrome.tabs.get(tabId);
    if (!eligible(tab)) return 'skip';
    if (tab.url !== state.url) { queue.schedule(tabId); return 'skip'; }
    windowVersion = windowRevisions.get(tab.windowId); tabVersion = tabRevisions.get(tabId);
    const capturedAt = Date.now();
    lastCaptureTime = capturedAt;
    const [dataUrl] = await Promise.all([
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 }),
      chrome.storage.session.set({ lastThumbnailCapture: lastCaptureTime })
    ]);
    if (!dataUrl) throw new Error('Empty capture');
    const current = await chrome.tabs.get(tabId);
    if (!sameTab(current, tab) || windowRevisions.get(tab.windowId) !== windowVersion || tabRevisions.get(tabId) !== tabVersion) return 'skip';
    const resized = await resizeThumbnail(dataUrl);
    const afterResize = await chrome.tabs.get(tabId);
    if (epoch !== captureEpoch || !sameTab(afterResize, tab) || windowRevisions.get(tab.windowId) !== windowVersion || tabRevisions.get(tabId) !== tabVersion) return 'skip';
    await storeThumbnail(session, tabId, tab.url!, resized);
    const afterStore = await chrome.tabs.get(tabId).catch(() => null);
    if (!afterStore) { await removeTabThumbnail(session, tabId); return 'skip'; }
    if (epoch !== captureEpoch || !sameTab(afterStore, tab) || tabRevisions.get(tabId) !== tabVersion) return 'skip';
    await saveState(tabId, { ...(states.get(tabId)?.url === tab.url ? states.get(tabId)! : state), status: 'ready', capturedAt, failures: 0, blockedUntil: 0 });
    await notify('mosaic:thumbnail-updated', tabId, tab.url!);
    if (Date.now() - lastPruneTime > 30000) {
      lastPruneTime = Date.now(); await pruneThumbnails(session).catch(() => {});
    }
    return 'done';
  } catch (error) {
    if (!tab) return 'skip';
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!current || !sameTab(current, tab) || tabRevisions.get(tabId) !== tabVersion || windowRevisions.get(tab.windowId) !== windowVersion) return 'skip';
    const state = stateFor(tab);
    const permission = /permission|not.*allowed|cannot access|<all_urls>|activeTab|file access/i.test(String(error));
    const failures = state.failures + 1;
    await saveState(tabId, { ...state, status: permission ? 'permission' : 'failed', failures,
      blockedUntil: permission ? Date.now() + STALE_AFTER : failures >= 3 ? Date.now() + 60000 : 0 });
    await notify('glimpse:preview-state', tabId, tab.url!);
    // Activity cannot reset the failure budget, including after worker suspension.
    return permission || failures >= 3 ? 'skip' : 'retry';
  }
});

async function captureActiveTabs(focusedOnly = false, beforeOverview = false) {
  await preferencesReady;
  if (preferences.paused || controlBusy) return;
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const pending: Promise<unknown>[] = [];
  for (const window of windows) {
    if (window.state === 'minimized' || focusedOnly && !window.focused) continue;
    for (const tab of window.tabs ?? []) if (eligible(tab)) {
      if (beforeOverview) pending.push(queue.request(tab.id!));
      else queue.schedule(tab.id!, window.focused ? 0 : 450);
    }
  }
  // A completion signal, with a small fixed opening budget; slow capture never holds the UI.
  if (pending.length) await Promise.race([Promise.allSettled(pending), wait(120)]);
}

async function initialize(allWindows = false) {
  const [session] = await Promise.all([sessionReady, stateReady, preferencesReady]);
  for (const host of preferences.excludedHosts) await clearThumbnails(host);
  const alarm = await chrome.alarms.get(ALARM);
  if (alarm?.periodInMinutes !== 5) await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
  await pruneThumbnails(session).catch(() => {});
  await captureActiveTabs(!allWindows);
}

async function openOverview() {
  const now = Date.now();
  if (now - lastToggleTime < 500) return;
  lastToggleTime = now;
  const url = chrome.runtime.getURL('overview/index.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url === url);
  if (existing?.id !== undefined) {
    await chrome.tabs.remove(existing.id);
    return;
  }
  // Cached images display immediately; queued captures notify the UI on completion.
  await captureActiveTabs(true, true);
  await chrome.windows.create({ url, type: 'popup', state: 'fullscreen' });
}

chrome.runtime.onInstalled.addListener(() => { void initialize(true).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void initialize(true).catch(console.error); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void captureActiveTabs(true).catch(() => {});
});
chrome.tabs.onActivated.addListener(info => {
  windowRevisions.set(info.windowId, (windowRevisions.get(info.windowId) ?? 0) + 1);
  void markDirty(info.tabId).catch(() => {});
});
chrome.tabs.onCreated.addListener(tab => {
  if (tab.active && tab.id !== undefined) void markDirty(tab.id, 650).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === 'loading') tabRevisions.set(tabId, (tabRevisions.get(tabId) ?? 0) + 1);
  if (change.url || change.status || change.title) void markDirty(tabId, 650).catch(() => {});
});
chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId < 0) return;
  void chrome.tabs.query({ active: true, windowId }).then(tabs => {
    tabs.forEach(tab => { if (tab.id !== undefined) void markDirty(tab.id).catch(() => {}); });
  }).catch(() => {});
});
function removeTab(tabId: number) {
  queue.cancel(tabId);
  tabRevisions.set(tabId, (tabRevisions.get(tabId) ?? 0) + 1);
  void stateReady.then(() => saveState(tabId, null));
  void sessionReady.then(session => removeTabThumbnail(session, tabId)).catch(() => {});
}
chrome.tabs.onRemoved.addListener(removeTab);
chrome.tabs.onReplaced.addListener((added, removed) => { removeTab(removed); void markDirty(added).catch(() => {}); });
chrome.windows.onRemoved.addListener(id => { windowRevisions.delete(id); });
async function previewControl(message: { action: string; settings?: unknown; host?: unknown }) {
  await Promise.all([preferencesReady, stateReady]);
  if (message.action === 'stats') return getCacheStats();
  if (message.action === 'settings') {
    const next = normalizePreviewSettings(message.settings), previous = preferences;
    captureEpoch++; controlBusy = true; preferences = next;
    try {
      await chrome.storage.local.set({ [PREVIEW_SETTINGS_KEY]: next });
      for (const host of next.excludedHosts) await clearThumbnails(host);
      for (const [id, state] of states) if (excludedUrl(state.url, next)) { queue.cancel(id); await saveState(id, null); }
      await chrome.runtime.sendMessage({ type: 'glimpse:cache-changed' }).catch(() => {});
      return next;
    } catch (error) {
      // The persisted policy wins if a cache deletion failed; never resume excluded captures.
      preferences = await readPreviewSettings().catch(() => previous);
      throw error;
    } finally { controlBusy = false; if (!preferences.paused) void captureActiveTabs(true).catch(() => {}); }
  }
  if (message.action === 'clear') {
    if (message.host !== undefined && (typeof message.host !== 'string' || !message.host.trim())) throw new Error('请选择有效的网站。');
    captureEpoch++; controlBusy = true;
    try {
      await clearThumbnails(message.host as string | undefined);
      for (const [id, state] of states) {
        const host = new URL(state.url).protocol === 'file:' ? '本地文件' : new URL(state.url).hostname;
        if (message.host === undefined || host === message.host) {
          queue.cancel(id); await saveState(id, { ...state, capturedAt: 0, dirtyAt: Date.now(), failures: 0, blockedUntil: 0, status: 'ready' });
        }
      }
      await chrome.runtime.sendMessage({ type: 'glimpse:cache-changed' }).catch(() => {});
      return getCacheStats();
    } finally { controlBusy = false; }
  }
  if (message.action === 'refresh') {
    if (preferences.paused) throw new Error('请先恢复自动更新。');
    const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
    let count = 0;
    for (const tab of tabs) if (eligible(tab)) {
      const state = stateFor(tab);
      await saveState(tab.id!, { ...state, blockedUntil: 0, failures: 0, dirtyAt: Math.max(Date.now(), state.capturedAt + 1) });
      queue.schedule(tab.id!, 0); count++;
    }
    return count;
  }
  throw new Error('不支持的预览操作。');
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[PREVIEW_SETTINGS_KEY]) {
    captureEpoch++; preferences = normalizePreviewSettings(changes[PREVIEW_SETTINGS_KEY].newValue);
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'glimpse:preview-control' && sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('overview/'))) {
    controls = controls.then(async () => {
      try { sendResponse({ ok: true, value: await previewControl(message) }); }
      catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : '操作未完成，请重试。' }); }
    }).catch(() => {});
    return true;
  }

  if (message?.type === 'mosaic:page-activity' && sender.frameId === 0 && sender.tab?.id !== undefined && !sender.tab.incognito) {
    void markDirty(sender.tab.id, 500).catch(() => {});
    sendResponse({ queued: true });
  }
});
chrome.permissions.onAdded.addListener(() => {
  void stateReady.then(async () => {
    for (const [id, state] of states) if (state.status === 'permission') await saveState(id, { ...state, blockedUntil: 0, failures: 0 });
    await captureActiveTabs(true);
  }).catch(() => {});
});
chrome.commands.onCommand.addListener(command => {
  if (command === '_execute_action' || command === 'open-overview') void openOverview().catch(console.error);
});
chrome.action.onClicked.addListener(() => { void openOverview().catch(console.error); });
void initialize().catch(console.error);
