const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { build } = require('esbuild');

async function bundle(entry, mockCache = false) {
  const result = await build({ entryPoints: [path.resolve(__dirname, '../src', entry)], bundle: true, format: 'iife', write: false,
    plugins: mockCache ? [{ name: 'test-cache', setup(builder) {
      builder.onLoad({ filter: /thumbnailCache\.ts$/ }, () => ({ contents: `
        export const canCaptureUrl = url => /^(https?|file):/.test(url);
        export const initializeThumbnailSession = async () => 'session';
        export const storeThumbnail = async (...args) => harness.stores.push(args);
        export const removeTabThumbnail = async (...args) => harness.removals.push(args);
        export const pruneThumbnails = async () => {};
        export const resizeThumbnail = async data => data;
      ` }));
    } }] : [] });
  return result.outputFiles[0].text;
}

function makeHarness() {
  let now = 100000, nextTimer = 0;
  const timers = new Map();
  const event = () => { const listeners = new Set(); return { addListener: cb => listeners.add(cb), emit: (...args) => listeners.forEach(cb => cb(...args)) }; };
  const h = { stores: [], removals: [], captures: [], messages: [], alarms: {}, session: {}, fail: 0, afterCapture: null, closed: [], created: [],
    tabs: [1, 2, 3].map(id => ({ id, windowId: id, url: `https://example.com/${id}`, active: true, status: 'complete', incognito: false, discarded: false })),
    windows: [1, 2, 3].map(id => ({ id, state: 'normal', type: 'normal', focused: id === 1 })) };
  const chrome = {
    storage: { session: { get: async key => ({ [key]: h.session[key] }), set: async values => Object.assign(h.session, values) } },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: p => 'chrome-extension://mosaic/' + p,
      sendMessage: async m => { h.messages.push(m); } },
    alarms: { onAlarm: event(), get: async name => h.alarms[name], create: async (name, options) => { h.alarms[name] = options; } },
    commands: { onCommand: event() }, action: { onClicked: event() },
    windows: { onFocusChanged: event(), onRemoved: event(),
      get: async id => ({ ...h.windows.find(w => w.id === id) }),
      getAll: async () => h.windows.map(w => ({ ...w, tabs: h.tabs.filter(t => t.windowId === w.id).map(t => ({ ...t })) })),
      create: async options => { h.created.push(options); } },
    tabs: {
      get: async id => { const tab = h.tabs.find(t => t.id === id); if (!tab) throw Error('Tab closed'); return { ...tab }; },
      query: async (query = {}) => h.tabs.filter(t => (!query.active || t.active) && (query.windowId === undefined || t.windowId === query.windowId)).map(t => ({ ...t })),
      remove: async id => { h.closed.push(id); },
      captureVisibleTab: async windowId => {
        h.captures.push({ time: now, windowId });
        if (h.fail > 0) { h.fail--; throw Error('Transient capture error'); }
        h.afterCapture?.();
        return `image-${windowId}-${now}`;
      },
      ...Object.fromEntries(['onActivated', 'onCreated', 'onUpdated', 'onRemoved', 'onReplaced'].map(name => [name, event()]))
    }
  };
  const context = vm.createContext({ harness: h, chrome, console, Date: { now: () => now },
    setTimeout: (fn, delay = 0) => { const id = ++nextTimer; timers.set(id, { fn, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  async function advance(ms) {
    const end = now + ms; await flush();
    for (let guard = 0; guard < 10000; guard++) {
      const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > end) break;
      now = Math.max(now, next[1].due); timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = end; await flush();
  }
  return { h, chrome, context, advance, flush, timers, now: () => now };
}

(async () => {
  const code = await bundle('background/service-worker.ts', true);
  const run = async () => { const test = makeHarness(); vm.runInContext(code, test.context); test.chrome.runtime.onStartup.emit(); await test.advance(5000); return test; };
  let { h, chrome, advance, flush, timers, context, now } = await run();
  assert.equal(h.stores.length, 3, 'installation/worker bootstrap captures visible tabs without opening UI');
  assert.equal(h.alarms['mosaic-thumbnail-refresh'].periodInMinutes, 0.5);
  assert.equal(h.messages.filter(m => m.type === 'mosaic:thumbnail-updated').length, 3);
  assert(h.captures.every((c, i, all) => i === 0 || c.time - all[i - 1].time >= 650), 'global capture quota');
  const before = h.captures.length;
  for (let i = 0; i < 40; i++) chrome.runtime.onMessage.emit({ type: 'mosaic:page-activity' }, { frameId: 0, tab: h.tabs[0] }, () => {});
  await advance(2000); assert.equal(h.captures.length, before + 1, 'bursts coalesce');
  h.fail = 2; chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
  const failedBefore = h.captures.length; await advance(7000);
  assert.equal(h.captures.length, failedBefore + 3, 'bounded retries recover transient failures');
  h.fail = 100; chrome.tabs.onActivated.emit({ tabId: 2, windowId: 2 });
  const hardFailureBefore = h.captures.length; await advance(10000);
  assert.equal(h.captures.length, hardFailureBefore + 3, 'permanent failure never spins'); h.fail = 0;
  const storedBefore = h.stores.length;
  h.afterCapture = () => { h.tabs[0].active = false; };
  chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 }); await advance(2500);
  assert.equal(h.stores.length, storedBefore, 'tab switched during capture is discarded');
  h.afterCapture = null; h.tabs[0].active = true;
  h.afterCapture = () => { h.tabs[0].url = 'https://example.com/new'; chrome.tabs.onUpdated.emit(1, { url: h.tabs[0].url }, h.tabs[0]); h.afterCapture = null; };
  chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 }); await advance(3500);
  assert.equal(h.stores.length, storedBefore + 1); assert.equal(h.stores.at(-1)[2], 'https://example.com/new');
  h.tabs[0].incognito = true; h.tabs[1].url = 'chrome://settings'; h.windows[2].state = 'minimized';
  const skippedBefore = h.captures.length;
  for (const tab of h.tabs) chrome.tabs.onActivated.emit({ tabId: tab.id, windowId: tab.windowId });
  await advance(4000); assert.equal(h.captures.length, skippedBefore, 'private, unsupported and minimized tabs skipped');
  h.tabs[0].incognito = false;
  chrome.alarms.onAlarm.emit({ name: 'mosaic-thumbnail-refresh' }); await advance(2000);
  assert.equal(h.captures.length, skippedBefore + 1, 'alarm refreshes focused normal window only');
  chrome.tabs.onRemoved.emit(1); await flush(); assert.equal(h.removals.at(-1)[1], 1);
  // A recreated worker has no JS state or timers. Session quota and alarms still work.
  timers.clear(); h.session.lastThumbnailCapture = now();
  vm.runInContext(code, context); await advance(500);
  assert.equal(h.captures.length, skippedBefore + 1, 'restart preserves rate-limit delay');
  await advance(1500); assert.equal(h.captures.length, skippedBefore + 2);
  // Moving overview to a normal window must not close other browser tabs.
  h.tabs.push({ id: 999, windowId: 1, url: 'chrome-extension://mosaic/overview/index.html' });
  chrome.action.onClicked.emit(); await flush(); assert(h.closed.includes(999)); assert.equal(h.created.length, 0);

  const content = await bundle('content/activity.ts');
  const events = new Map(), messages = [];
  const doc = { visibilityState: 'visible', addEventListener: (name, fn) => events.set(name, fn) };
  const contentTest = makeHarness();
  Object.assign(contentTest.context, { document: doc, window: { addEventListener: (name, fn) => events.set(name, fn) },
    chrome: { runtime: { id: 'test', sendMessage: async m => { messages.push(m); } } } });
  vm.runInContext(content, contentTest.context); await contentTest.advance(1000); assert.equal(messages.length, 1);
  for (let i = 0; i < 50; i++) events.get('scroll')();
  await contentTest.advance(2000); assert.equal(messages.length, 1);
  await contentTest.advance(1000); assert.equal(messages.length, 2);
  doc.visibilityState = 'hidden'; events.get('click')(); await contentTest.advance(5000); assert.equal(messages.length, 2);
  assert(messages.every(m => Object.keys(m).length === 1 && m.type === 'mosaic:page-activity'), 'no page text or form contents sent');
  console.log('PASS: background bootstrap, alarms, coalescing, global rate limit, retries, race checks, skip rules, worker restart, overview safety and content activity throttling.');
})().catch(error => { console.error(error); process.exitCode = 1; });
