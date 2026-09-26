const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

const code = buildSync({ stdin: { contents: "export * from './lib/overviewOrder'; export * from './lib/undoClose';", resolveDir: path.resolve(__dirname, '../src'), loader: 'ts' }, bundle: true, format: 'iife', globalName: 'Interactions', write: false }).outputFiles[0].text;
function fixture(sessionMode = 'available') {
  const state = { sessions: [], restored: [], created: [], windowsCreated: [], removed: [], unavailable: false, noSession: false, ambiguous: false, windowClosed: false, multiWindow: false, failRestore: false };
  const context = vm.createContext({ crypto, Date, setTimeout: fn => setImmediate(fn), clearTimeout: id => clearImmediate(id),
    chrome: {
      sessions: {
        getRecentlyClosed: async () => { if (state.unavailable) throw Error('unavailable'); return state.sessions; },
        restore: async id => { if (state.failRestore) throw Error('restore failed'); state.restored.push(id); const session = state.sessions.find(s => (s.tab?.sessionId ?? s.window?.sessionId) === id); state.sessions = state.sessions.filter(s => s !== session); return session; }
      },
      tabs: {
        remove: async id => {
          if (state.failRemove) throw Error('Tab removal failed');
          state.removed.push(id);
          if (state.noSession) return;
          const tab = { id, title: 'Same title', url: 'https://same.example/', windowId: 10, index: 0, sessionId: `session-${id}` };
          if (state.windowClosed) state.sessions.unshift({ window: { sessionId: `window-${id}`, tabs: state.multiWindow ? [tab, { ...tab, id: 999 }] : [tab] } });
          else state.sessions.unshift({ tab });
          if (state.ambiguous) state.sessions.unshift({ tab: { ...tab, sessionId: `other-${id}` } });
        },
        query: async () => [{ id: 50 }],
        create: async properties => { state.created.push(properties); return { id: 500, ...properties }; }
      },
      windows: {
        get: async id => { if (state.windowClosed) throw Error('window gone'); return { id, type: 'normal', incognito: false }; },
        create: async properties => { state.windowsCreated.push(properties); return { tabs: [{ id: 600, windowId: 20, ...properties }] }; }
      }
    }
  });
  if (sessionMode === 'missing') delete context.chrome.sessions;
  if (sessionMode === 'throws') context.chrome.sessions.getRecentlyClosed = () => { throw Error('Session permission unavailable'); };
  if (sessionMode === 'rejects') context.chrome.sessions.getRecentlyClosed = async () => { throw Error('Session permission unavailable'); };
  if (sessionMode === 'hangs') context.chrome.sessions.getRecentlyClosed = () => new Promise(() => {});
  if (sessionMode === 'fails-after-close') context.chrome.sessions.getRecentlyClosed = () => {
    if (state.removed.length) throw Error('Session context invalidated');
    return Promise.resolve([]);
  };
  vm.runInContext(code, context);
  return { api: context.Interactions, state };
}
const tab = id => ({ id, title: 'Same title', url: 'https://same.example/', windowId: 10, index: 0, active: false, favIconUrl: '' });

(async () => {
  let { api, state } = fixture();
  const merged = api.reconcileTabs([tab(1), tab(2)], [{ ...tab(2), title: 'Updated' }, tab(3), tab(1)]);
  assert.deepEqual(Array.from(merged, t => t.id), [1, 2, 3]); assert.equal(merged[1].title, 'Updated');
  const numbers = api.reconcileWindowNumbers(new Map([[10, 1], [20, 2]]), [{ ...tab(1), windowId: 20 }, { ...tab(2), windowId: 30 }]);
  assert.deepEqual(Array.from(numbers, pair => Array.from(pair)), [[10, 1], [20, 2], [30, 3]]);

  for (const mode of ['missing', 'throws', 'rejects', 'hangs', 'fails-after-close']) {
    const test = fixture(mode);
    const record = await test.api.closeWithUndo(tab(90));
    assert.deepEqual(test.state.removed, [90], `close works with sessions ${mode}`);
    assert.equal(record.sessionId, undefined);
    await test.api.restoreClosedTab(record);
    assert.equal(test.state.created.length, 1, `URL undo remains available with sessions ${mode}`);
  }
  const unavailableRestore = fixture();
  const savedRecord = await unavailableRestore.api.closeWithUndo(tab(91));
  unavailableRestore.state.unavailable = true;
  await assert.rejects(unavailableRestore.api.restoreClosedTab(savedRecord), /暂时无法读取恢复记录/);
  assert.equal(unavailableRestore.state.created.length, 0, 'uncertain session access never duplicates an existing session');

  const failedClose = fixture();
  failedClose.state.failRemove = true;
  await assert.rejects(failedClose.api.closeWithUndo(tab(92)), /Tab removal failed/);
  assert.equal(failedClose.state.removed.length, 0);
  failedClose.state.failRemove = false;
  await failedClose.api.closeWithUndo(tab(93));
  assert.deepEqual(failedClose.state.removed, [93], 'a failed close does not block subsequent closes');

  const [first, second] = await Promise.all([api.closeWithUndo(tab(1)), api.closeWithUndo(tab(2))]);
  assert.equal(first.sessionId, 'session-1'); assert.equal(second.sessionId, 'session-2');
  state.sessions.unshift({ tab: { id: 999, url: 'https://unrelated.example/', sessionId: 'external-close' } });
  await api.restoreClosedTab(first);
  assert.deepEqual(state.restored, ['session-1'], 'restore exact session, never latest external close');
  await assert.rejects(api.restoreClosedTab(first), /已被恢复/);
  assert.equal(state.created.length, 0, 'consumed session cannot accidentally duplicate a tab');
  state.failRestore = true;
  await assert.rejects(api.restoreClosedTab(second), /restore failed/);
  assert.equal(state.created.length, 0, 'uncertain restore failure cannot silently reopen another tab');

  ({ api, state } = fixture()); state.noSession = true;
  const fallback = await api.closeWithUndo({ ...tab(3), index: 8 });
  assert.equal(fallback.sessionId, undefined);
  assert.equal((await api.restoreClosedTab(fallback)).recreated, true);
  assert.equal(state.created[0].windowId, 10); assert.equal(state.created[0].index, 1); assert.equal(state.created[0].active, false);

  ({ api, state } = fixture()); state.ambiguous = true;
  const ambiguous = await api.closeWithUndo(tab(4)); assert.equal(ambiguous.sessionId, undefined);
  await api.restoreClosedTab(ambiguous); assert.equal(state.restored.length, 0); assert.equal(state.created.length, 1);

  ({ api, state } = fixture()); state.windowClosed = true;
  const last = await api.closeWithUndo(tab(5)); assert.equal(last.sessionId, 'window-5');
  await api.restoreClosedTab(last); assert.deepEqual(state.restored, ['window-5']);

  ({ api, state } = fixture()); state.windowClosed = true; state.multiWindow = true;
  const multi = await api.closeWithUndo(tab(6)); assert.equal(multi.sessionId, undefined);
  await api.restoreClosedTab(multi); assert.equal(state.restored.length, 0); assert.equal(state.windowsCreated.length, 1);

  ({ api, state } = fixture()); state.noSession = true; state.windowClosed = true;
  const privateTab = await api.closeWithUndo({ ...tab(7), incognito: true });
  await api.restoreClosedTab(privateTab); assert.equal(state.windowsCreated[0].incognito, true);
  const restricted = await api.closeWithUndo({ ...tab(8), url: 'javascript:alert(1)' });
  await assert.rejects(api.restoreClosedTab(restricted), /无法自动/);
  console.log('PASS: stable ordering, stable window labels, serialized close, exact-session undo, expired/failed restore, safe URL fallback, last-window recovery, ambiguous and multi-tab sessions, incognito boundary.');
})().catch(error => { console.error(error); process.exitCode = 1; });
