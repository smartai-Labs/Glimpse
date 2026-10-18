const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { build } = require('esbuild');

async function load(file, globals = {}) {
  const { outputFiles } = await build({ entryPoints: [path.resolve(__dirname, '../src/lib', file)], bundle: true, platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} };
  vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports, require, console, URL, ...globals });
  return module.exports;
}

(async () => {
  const { createTabSearchProvider, searchHighlights } = await load('tabSearch.ts');
  const provider = createTabSearchProvider();
  const tabs = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, title: '页面 ' + (i + 1) + (i % 2 ? '设计工作' : '项目开发'),
    url: 'https://site' + (i % 10) + '.example/page/' + (i + 1), active: i === 0, windowId: Math.floor(i / 50), index: i % 50, favIconUrl: '' }));
  const index = provider(tabs);
  assert.equal(provider(tabs.map(tab => ({ ...tab, active: !tab.active, status: 'loading', windowId: 100, favIconUrl: 'updated' }))), index,
    'activation, loading, icons and window movement reuse the search index');
  const renamed = tabs.map(tab => tab.id === 1 ? { ...tab, title: 'ＡＩ 绘图指南' } : tab);
  const changedIndex = provider(renamed);
  assert.notEqual(changedIndex, index, 'title change rebuilds the index');
  assert.equal(changedIndex.search('AI')[0].item.id, 1, 'full-width title normalization retained');
  assert.notEqual(provider(renamed.map(tab => tab.id === 1 ? { ...tab, url: 'https://new.example' } : tab)), changedIndex);
  const removed = provider(tabs.slice(1));
  assert(!removed.search('页面 1').some(result => result.item.id === 1), 'removed IDs cannot survive in results');
  const rankedTabs = [
    { ...tabs[0], id: 1, title: 'github.com 入门', url: 'https://other.example/notes' },
    { ...tabs[0], id: 2, title: '代码仓库', url: 'https://github.com/project' },
    { ...tabs[0], id: 3, title: 'github.com', url: 'https://notes.example' },
    { ...tabs[0], id: 4, title: '设计参考 交互笔记', url: 'https://other.example/4' },
    { ...tabs[0], id: 5, title: '参考交互设计', url: 'https://other.example/5' }
  ];
  const ranked = provider(rankedTabs);
  assert.deepEqual(Array.from(ranked.search('github.com').slice(0, 3), hit => hit.item.id), [2, 3, 1], 'exact domain/title outrank partial matches with stable ties');
  assert.deepEqual(Array.from(ranked.search('设计 参考').slice(0, 2), hit => hit.item.id), [4, 5], 'all words may occur in any order');
  assert(ranked.search('githb.com').some(hit => hit.item.id === 2), 'typos retain fuzzy fallback');
  assert.equal(JSON.stringify(searchHighlights('ＡＩ 绘图', 'AI')), '[[0,2]]');
  assert.equal(JSON.stringify(searchHighlights('ﬀ foo', 'f')), '[[0,1],[2,3]]', 'normalization expansion maps to whole original graphemes');
  assert.equal(JSON.stringify(searchHighlights('参考 设计参考', '设计 参考')), '[[0,2],[3,7]]', 'overlapping and adjacent matches merge');
  const local = {};
  const { recentTabOrder, tabsInSnapshotOrder, readCardDensity, saveCardDensity } = await load('finderOptions.ts', {
    setTimeout, clearTimeout, chrome: { storage: { local: { get: async () => local, set: async values => Object.assign(local, values) } } }
  });
  const recent = rankedTabs.map((tab, i) => ({ ...tab, lastAccessed: 100 + i }));
  const snapshot = recentTabOrder(recent);
  assert.deepEqual(Array.from(snapshot), [5, 4, 3, 2, 1]);
  recent[0].lastAccessed = 999;
  assert.deepEqual(Array.from(tabsInSnapshotOrder(recent, snapshot), tab => tab.id), [5, 4, 3, 2, 1], 'live activity cannot reshuffle a recent snapshot');
  assert.deepEqual(Array.from(tabsInSnapshotOrder([...recent.slice(1), { ...recent[0], id: 6 }], snapshot), tab => tab.id), [5, 4, 3, 2, 6], 'removed tabs vanish and new tabs append');
  assert.deepEqual(Array.from(recentTabOrder(rankedTabs.map(tab => ({ ...tab, active: tab.id === 3 })))), [3, 1, 2, 4, 5], 'older Chrome without access timestamps falls back predictably');
  assert.equal(await readCardDensity(), 'standard');
  assert.equal(await saveCardDensity('compact'), true); assert.equal(await readCardDensity(), 'compact');
  local.glimpseDisplay = { density: 'invalid' }; assert.equal(await readCardDensity(), 'standard');
  const samples = [], benchmark = provider(tabs);
  for (let i = 0; i < 100; i++) {
    const started = performance.now(); benchmark.search(i % 2 ? '设计' : 'site5'); samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const storage = {};
  const { describePreview, getPreviewState, isPreviewState } = await load('previewState.ts', {
    chrome: { storage: { session: { get: async key => ({ [key]: storage[key] }) } } }
  });
  const tab = tabs[0];
  const state = { url: tab.url, status: 'permission', capturedAt: 1000, dirtyAt: 2000, failures: 1, blockedUntil: 10000 };
  storage['glimpse:preview:1'] = state;
  assert.equal((await getPreviewState(1, tab.url)).status, 'permission');
  assert.equal(await getPreviewState(1, 'https://different.example'), null, 'old URL failure never labels a new page');
  assert(!isPreviewState({ ...state, capturedAt: 'bad' }), 'invalid session records ignored');
  assert.equal(describePreview(tab, null).label, '浏览后生成预览');
  assert.equal(describePreview({ ...tab, status: 'loading' }, state).label, '页面加载中');
  assert.equal(describePreview({ ...tab, discarded: true }, null).label, '浏览后更新预览');
  assert.equal(describePreview(tab, state).label, '需要访问权限');
  assert.equal(describePreview(tab, { ...state, status: 'failed' }).label, '预览暂不可用');
  assert.equal(describePreview(tab, null, true).label, '预览暂不可用');
  assert.equal(describePreview({ ...tab, url: 'chrome://settings' }, null).label, '不支持预览');
  assert.equal(describePreview({ ...tab, incognito: true }, state).label, '隐身页面');
  console.log('PASS: search-index reuse, current IDs, preview states and URL isolation; 500-tab search P95 ' + samples[94].toFixed(2) + 'ms (index only, local test).');
})().catch(error => { console.error(error); process.exitCode = 1; });
