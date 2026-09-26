const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../src/lib/batchActions.ts')], bundle: true, format: 'iife', globalName: 'Batch', write: false }).outputFiles[0].text;

function fixture() {
  const tab = (id, windowId, index, extra = {}) => ({ id, windowId, index, title: `Page ${id}`, url: `https://example.test/${id}`, incognito: windowId >= 4 && windowId <= 5, pinned: false, groupId: -1, ...extra });
  const state = {
    tabs: [tab(1, 1, 0, { pinned: true }), tab(2, 1, 1), tab(3, 2, 0, { pinned: true }), tab(4, 2, 1, { groupId: 10 }), tab(5, 2, 2, { groupId: 10 }), tab(6, 3, 0), tab(7, 4, 0), tab(8, 5, 0), tab(9, 99, 0), tab(10, 3, 1, { url: 'chrome-extension://mosaic/overview/index.html' })],
    windows: [1, 2, 3, 4, 5, 99].map(id => ({ id, type: id === 99 ? 'popup' : 'normal', incognito: id === 4 || id === 5 })),
    last: 1, moved: [], removed: [], sessions: [], failMove: new Set(), failRemove: new Set(), groups: [{ id: 10, title: 'Research', color: 'grey', collapsed: true }]
  };
  const query = async filter => state.tabs.filter(tab => Object.entries(filter).every(([key, value]) => tab[key] === value)).map(tab => ({ ...tab }));
  const get = async id => { const tab = state.tabs.find(tab => tab.id === id); if (!tab) throw Error('Tab gone'); return { ...tab }; };
  const move = async (ids, target, isGroup = false) => {
    const moving = state.tabs.filter(tab => ids.includes(tab.id));
    if (moving.some(tab => state.failMove.has(tab.id))) throw Error('Move failed');
    assert(moving.every(tab => tab.incognito === state.windows.find(window => window.id === target.windowId).incognito), 'privacy contexts never cross');
    if (moving[0]?.pinned) assert.equal(target.index, state.tabs.filter(tab => tab.windowId === target.windowId && tab.pinned).length, 'pinned tabs go directly after existing pinned tabs');
    state.moved.push({ ids, ...target, isGroup });
    moving.forEach(tab => { tab.windowId = target.windowId; });
    return moving;
  };
  const chrome = {
    runtime: { getURL: () => 'chrome-extension://mosaic/' },
    windows: {
      getAll: async () => state.windows.map(window => ({ ...window, tabs: state.tabs.filter(tab => tab.windowId === window.id).map(tab => ({ ...tab })) })),
      getLastFocused: async () => ({ id: state.last }),
      get: async id => { const window = state.windows.find(window => window.id === id); if (!window) throw Error('Window gone'); return window; }
    },
    tabs: { query, get, move: async (id, target) => move([id], target), remove: async id => {
      if (state.failRemove.has(id)) throw Error('Close failed');
      const tab = await get(id); state.removed.push(id); state.tabs = state.tabs.filter(tab => tab.id !== id);
      state.sessions.unshift({ tab: { ...tab, sessionId: `closed-${id}` } });
    } },
    tabGroups: { move: async (groupId, target) => { await move(state.tabs.filter(tab => tab.groupId === groupId).map(tab => tab.id), target, true); return state.groups.find(group => group.id === groupId); } },
    sessions: { getRecentlyClosed: async () => state.sessions }
  };
  const context = vm.createContext({ chrome, crypto, Date, setTimeout, clearTimeout });
  vm.runInContext(code, context);
  return { api: context.Batch, state, chrome };
}

(async () => {
  const merged = fixture();
  const progress = [];
  const result = await merged.api.mergeBrowserWindows((done, total) => progress.push([done, total]));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { moved: 5, failed: 0, skipped: 0, separatePrivate: true });
  assert.equal(merged.state.tabs.find(tab => tab.id === 8).windowId, 4);
  assert.equal(merged.state.tabs.find(tab => tab.id === 9).windowId, 99, 'popup windows are excluded');
  assert.equal(merged.state.tabs.find(tab => tab.id === 10).windowId, 3, 'Mosaic itself is excluded');
  assert.deepEqual(merged.state.moved.find(move => move.isGroup).ids, [4, 5], 'groups move as one unit');
  assert.deepEqual(merged.state.groups[0], { id: 10, title: 'Research', color: 'grey', collapsed: true });
  assert.equal(merged.state.tabs.find(tab => tab.id === 3).pinned, true);
  assert.deepEqual(progress.at(-1), [5, 5]);
  assert.equal((await merged.api.mergeBrowserWindows(() => {})).moved, 0, 'a repeated merge is a no-op');

  const partial = fixture(); partial.state.failMove.add(4);
  const partialResult = await partial.api.mergeBrowserWindows(() => {});
  assert.equal(partialResult.moved, 3); assert.equal(partialResult.failed, 2);
  assert.equal(partial.state.tabs.find(tab => tab.id === 4).windowId, 2, 'failed group stays intact');
  const unavailable = fixture(); delete unavailable.chrome.tabGroups;
  assert.equal((await unavailable.api.mergeBrowserWindows(() => {})).failed, 2, 'missing group permission never dissolves groups');
  const vanished = fixture(); vanished.chrome.windows.get = async () => { throw Error('Destination closed'); };
  assert.equal((await vanished.api.mergeBrowserWindows(() => {})).failed, 5);
  assert.equal(vanished.state.moved.length, 0);
  const fallback = fixture(); fallback.state.last = 99;
  assert.equal((await fallback.api.mergeBrowserWindows(() => {})).moved, 5, 'a popup can never become the destination');

  const close = fixture(); close.state.failRemove.add(2);
  const snapshot = close.state.tabs.slice(0, 3).map(tab => ({ ...tab }));
  close.state.tabs[0].url = 'https://example.test/new-url';
  const closed = await close.api.closeTabsWithUndo([...snapshot, snapshot[0]], () => {});
  assert.deepEqual(close.state.removed, [1, 3], 'duplicate selections close once; failures do not stop the batch');
  assert.deepEqual(Array.from(closed.failedIds), [2]);
  assert.equal(closed.closed[0].tab.url, 'https://example.test/new-url', 'undo records the live page');
  assert.deepEqual(Array.from(closed.closed, item => item.sessionId), ['closed-1', 'closed-3']);
  assert.equal(close.state.tabs.some(tab => tab.id === 4), true, 'unselected tabs remain untouched');
  console.log('PASS: batch-close scope/duplicates/live URLs/partial failure; merging targets, pinned positions, intact groups, private isolation, permission/destination failures and no-op repeat.');
})().catch(error => { console.error(error); process.exitCode = 1; });
