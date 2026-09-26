import { canCaptureUrl, initializeThumbnailSession, storeThumbnail, removeTabThumbnail, pruneThumbnails, resizeThumbnail } from '../lib/thumbnailCache';
import { CaptureQueue } from './captureQueue';

const ALARM = 'mosaic-thumbnail-refresh';
const INTERVAL = 650; // At most two captureVisibleTab calls in any one-second window.
const sessionReady = initializeThumbnailSession();
const windowRevisions = new Map<number, number>();
const tabRevisions = new Map<number, number>();
let lastToggleTime = 0, lastPruneTime = 0, lastCaptureTime = 0;

function eligible(tab: chrome.tabs.Tab): boolean {
  return tab.id !== undefined && tab.active && !tab.incognito && !tab.discarded && tab.status !== 'loading' && canCaptureUrl(tab.url ?? '');
}
function sameTab(tab: chrome.tabs.Tab, original: chrome.tabs.Tab): boolean {
  return eligible(tab) && tab.id === original.id && tab.url === original.url && tab.windowId === original.windowId;
}
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const queue = new CaptureQueue(async tabId => {
  try {
    const session = await sessionReady;
    let tab = await chrome.tabs.get(tabId);
    if (!eligible(tab)) return 'skip';
    const window = await chrome.windows.get(tab.windowId);
    if (window.state === 'minimized' || window.type !== 'normal') return 'skip';
    const stored = await chrome.storage.session.get('lastThumbnailCapture');
    const last = Math.max(lastCaptureTime, typeof stored.lastThumbnailCapture === 'number' ? stored.lastThumbnailCapture : 0);
    await wait(Math.max(0, INTERVAL - (Date.now() - last)));
    tab = await chrome.tabs.get(tabId);
    if (!eligible(tab)) return 'skip';
    const windowVersion = windowRevisions.get(tab.windowId), tabVersion = tabRevisions.get(tabId);
    // Persist the rate limit across worker suspension as well as across jobs.
    lastCaptureTime = Date.now();
    const [dataUrl] = await Promise.all([
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 }),
      chrome.storage.session.set({ lastThumbnailCapture: lastCaptureTime })
    ]);
    if (!dataUrl) return 'retry';
    const current = await chrome.tabs.get(tabId);
    if (!sameTab(current, tab) || windowRevisions.get(tab.windowId) !== windowVersion || tabRevisions.get(tabId) !== tabVersion) return 'skip';
    const resized = await resizeThumbnail(dataUrl);
    const afterResize = await chrome.tabs.get(tabId);
    if (!sameTab(afterResize, tab) || windowRevisions.get(tab.windowId) !== windowVersion || tabRevisions.get(tabId) !== tabVersion) return 'skip';
    await storeThumbnail(session, tabId, tab.url!, resized);
    await chrome.runtime.sendMessage({ type: 'mosaic:thumbnail-updated', tabId, url: tab.url }).catch(() => {});
    if (Date.now() - lastPruneTime > 30000) {
      lastPruneTime = Date.now(); await pruneThumbnails(session);
    }
    return 'done';
  } catch {
    // Missing tabs, denied host access, and transient capture failures are normal.
    return 'retry';
  }
});

async function captureActiveTabs(focusedOnly = false) {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  for (const window of windows) {
    if (window.state === 'minimized' || focusedOnly && !window.focused) continue;
    for (const tab of window.tabs ?? []) if (eligible(tab)) queue.schedule(tab.id!);
  }
}

async function initialize(allWindows = false) {
  const session = await sessionReady;
  if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  await pruneThumbnails(session);
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
    // The overview can be moved into a regular browser window: close only its tab.
    await chrome.tabs.remove(existing.id);
    return;
  }
  // Refresh the page the user is leaving before covering it with the overview.
  await captureActiveTabs(true);
  await chrome.windows.create({ url, type: 'popup', state: 'fullscreen' });
}

chrome.runtime.onInstalled.addListener(() => { void initialize(true).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void initialize(true).catch(console.error); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void captureActiveTabs(true).catch(() => {});
});
chrome.tabs.onActivated.addListener(info => {
  windowRevisions.set(info.windowId, (windowRevisions.get(info.windowId) ?? 0) + 1);
  queue.schedule(info.tabId);
});
chrome.tabs.onCreated.addListener(tab => {
  if (tab.active && tab.id !== undefined) queue.schedule(tab.id, 650);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'loading') tabRevisions.set(tabId, (tabRevisions.get(tabId) ?? 0) + 1);
  if (tab.active && (change.status === 'complete' || change.url || change.title)) queue.schedule(tabId, 650);
});
chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId < 0) return;
  void chrome.tabs.query({ active: true, windowId }).then(tabs => {
    tabs.forEach(tab => { if (tab.id !== undefined) queue.schedule(tab.id); });
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  queue.cancel(tabId); tabRevisions.delete(tabId);
  void sessionReady.then(session => removeTabThumbnail(session, tabId)).catch(() => {});
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  queue.cancel(removed); queue.schedule(added);
  void sessionReady.then(session => removeTabThumbnail(session, removed)).catch(() => {});
});
chrome.windows.onRemoved.addListener(id => { windowRevisions.delete(id); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'mosaic:page-activity' && sender.frameId === 0 && sender.tab?.id !== undefined && !sender.tab.incognito) {
    queue.schedule(sender.tab.id, 500);
    sendResponse({ queued: true });
  }
});
chrome.commands.onCommand.addListener(command => {
  if (command === '_execute_action' || command === 'open-overview') void openOverview().catch(console.error);
});
chrome.action.onClicked.addListener(() => { void openOverview().catch(console.error); });
// A recreated worker repairs a missing alarm and recovers interrupted jobs from live tabs.
void initialize().catch(console.error);
