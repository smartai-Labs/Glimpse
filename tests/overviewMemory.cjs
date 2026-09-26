const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../src/lib/overviewMemory.ts')], bundle: true, format: 'iife', globalName: 'Memory', write: false }).outputFiles[0].text;
let stored = {}, unavailable = false;
const context = vm.createContext({ Date, setTimeout, clearTimeout, chrome: { storage: { session: {
  get: async () => { if (unavailable) throw Error('unavailable'); return stored; },
  set: async value => { if (unavailable) throw Error('unavailable'); Object.assign(stored, value); }
} } } });
vm.runInContext(code, context);
const api = context.Memory;
(async () => {
  assert.equal(await api.readOverviewPosition(), null);
  const position = { savedAt: Date.now(), order: [3, 1, 2], windows: [[10, 1]], anchorId: 1, anchorIndex: 1, rowOffset: 20 };
  await api.saveOverviewPosition(position);
  const read = await api.readOverviewPosition();
  assert.equal(read.anchorId, 1);
  const tabs = [{ id: 2 }, { id: 1 }, { id: 4 }];
  const ordered = api.orderFromPosition(tabs, read);
  assert.deepEqual(Array.from(ordered, tab => tab.id), [1, 2, 4], 'closed IDs disappear and new tabs append');
  assert.equal(api.scrollFromPosition(read, ordered, 3, 200), 20, 'resize restores the row containing the anchor');
  assert.equal(api.scrollFromPosition({ ...read, anchorId: 999, anchorIndex: 100, rowOffset: 500 }, ordered, 1, 200), 599, 'missing anchors and row offsets stay in bounds');
  stored.mosaicOverviewPosition.savedAt = Date.now() - 31 * 60 * 1000;
  assert.equal(await api.readOverviewPosition(), null, 'old navigation context expires');
  stored.mosaicOverviewPosition = { ...position, savedAt: Date.now(), order: ['bad'] };
  assert.equal(await api.readOverviewPosition(), null, 'malformed state is ignored');
  unavailable = true;
  assert.equal(await api.readOverviewPosition(), null);
  await api.saveOverviewPosition(position);
  console.log('PASS: position restore, surviving tab order, resized/missing anchors, expiry, malformed state and unavailable storage.');
})().catch(error => { console.error(error); process.exitCode = 1; });
