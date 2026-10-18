// Run after npm run build. Uses an installed Playwright and an isolated Chrome profile.
// Optionally set MOSAIC_PLAYWRIGHT_PATH to an existing Playwright installation.
const { chromium } = require(process.env.MOSAIC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist');
const cacheModule = require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/lib/thumbnailCache.ts')], bundle: true, format: 'esm', write: false }).outputFiles[0].text;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.includes('_favicon')) { res.setHeader('Content-Type', 'image/png'); return res.end(pixel); }
  if (pathname === '/fixture') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>Test fixture</title>'); }
  if (pathname === '/cache-test.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(cacheModule); }
  if (pathname === '/resize-worker.js') {
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(`import { resizeThumbnail } from '/cache-test.js';
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('message', event => event.waitUntil((async () => {
        try { const data = await resizeThumbnail(event.data); const bitmap = await createImageBitmap(await (await fetch(data)).blob());
          event.ports[0].postMessage({ width: bitmap.width, height: bitmap.height, serviceWorker: self instanceof ServiceWorkerGlobalScope }); bitmap.close();
        } catch(error) { event.ports[0].postMessage({ error: String(error) }); }
      })()));`);
  }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.GLIMPSE_BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const setupBrowser = () => {
      const event = () => {
        const listeners = new Set();
        return { addListener: cb => listeners.add(cb), removeListener: cb => listeners.delete(cb), emit: (...args) => listeners.forEach(cb => cb(...args)) };
      };
      const hosts = ['github.com', 'mp.weixin.qq.com', 'docs.qq.com', 'zhihu.com'];
      window.testTabs = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, title: `页面 ${i + 1} · ${i % 2 ? '写作' : '项目'}`, url: `https://${hosts[i % 4]}/page/${i + 1}`, windowId: Math.floor(i / 40) + 1, active: i === 0, index: i % 40 }));
      window.calls = []; window.close = () => window.calls.push(['close-overview']);
      window.testSession = { thumbnailSession: 'test-session', ...JSON.parse(sessionStorage.getItem('mosaic-test-storage') || '{}') };
      window.testLocal = JSON.parse(localStorage.getItem('glimpse-test-local') || '{}');
      window.closedSessions = [];
      window.lastFocusedWindow = Number(sessionStorage.getItem('mosaic-test-focused')) || 1;
      window.chrome = {
        runtime: { getManifest: () => ({ version: '1.12.0' }), sendMessage: async message => {
          const cache = await import('/cache-test.js');
          if (message.action === 'stats') return { ok: true, value: await cache.getCacheStats() };
          if (message.action === 'clear') { await cache.clearThumbnails(message.host); chrome.runtime.onMessage.emit({type:'glimpse:cache-changed'}); return {ok:true,value:await cache.getCacheStats()}; }
          if (message.action === 'settings') { await chrome.storage.local.set({glimpsePreviewSettings:message.settings}); for(const host of message.settings.excludedHosts) await cache.clearThumbnails(host); chrome.runtime.onMessage.emit({type:'glimpse:cache-changed'});return {ok:true,value:message.settings}; }
          if (message.action === 'refresh') return {ok:true,value:1};
          return {ok:false};
        }, getURL: p => location.origin + '/extension/' + p.replace(/^\//, ''), onMessage: event() },
        storage: { onChanged: event(), local: { get: async () => window.testLocal, set: async values => { Object.assign(window.testLocal, values); localStorage.setItem('glimpse-test-local', JSON.stringify(window.testLocal)); chrome.storage.onChanged.emit(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local'); } }, session: { get: async () => window.testSession, set: async values => { Object.assign(window.testSession, values); sessionStorage.setItem('mosaic-test-storage', JSON.stringify(window.testSession)); } } },
        sessions: {
          getRecentlyClosed: async () => window.closedSessions,
          restore: async sessionId => {
            window.calls.push(['restore-session', sessionId]);
            const record = window.closedSessions.find(item => item.tab.sessionId === sessionId);
            if (!record) throw new Error('Session unavailable');
            window.closedSessions = window.closedSessions.filter(item => item !== record);
            const tab = { ...record.tab, id: 1000 + record.tab.id }; delete tab.sessionId;
            window.testTabs.push(tab); chrome.tabs.onCreated.emit(tab); return { tab };
          }
        },
        commands: { getAll: async () => [{ name: '_execute_action', shortcut: 'Ctrl+Shift+Period' }] },
        windows: {
          getLastFocused: async () => ({ id: window.lastFocusedWindow }),
          getAll: async () => [...new Set(window.testTabs.map(tab => tab.windowId))].map(id => ({ id, type: 'normal', incognito: false, tabs: window.testTabs.filter(tab => tab.windowId === id) })),
          get: async id => { if (!window.testTabs.some(tab => tab.windowId === id)) throw Error('Window gone'); return { id, type: 'normal', incognito: false }; },
          getCurrent: async () => ({ id: 99, type: 'popup' }),
          update: async (id, changes) => { window.calls.push(['focus-window', id, changes]); }
        },
        tabs: {
          get: async id => { const tab = window.testTabs.find(tab => tab.id === id); if (!tab) throw Error('Tab gone'); return { ...tab }; },
          move: async (id, properties) => {
            if (window.failMoveIds?.includes(id)) throw Error('Move failed');
            const tab = window.testTabs.find(tab => tab.id === id);
            if (!tab) throw Error('Tab gone');
            window.calls.push(['move-tab', id, properties]); Object.assign(tab, properties); chrome.tabs.onAttached.emit(id);
            return tab;
          },
          query: async (query = {}) => {
            window.tabQueries = (window.tabQueries || 0) + 1;
            const delay = Number(new URL(location.href).searchParams.get('delayTabs') || 0);
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            return window.testTabs.filter(tab => (query.windowId === undefined || tab.windowId === query.windowId) && (query.groupId === undefined || tab.groupId === query.groupId) && (query.pinned === undefined || !!tab.pinned === query.pinned));
          },
          update: async (id, changes) => { window.calls.push(['select-tab', id, changes]); },
          remove: async id => {
            if (window.failNextRemove || window.failRemoveIds?.includes(id)) { window.failNextRemove = false; throw new Error('Tab removal failed'); }
            window.calls.push(['remove-tab', id]);
            const tab = window.testTabs.find(t => t.id === id);
            if (tab) window.closedSessions.unshift({ tab: { ...tab, sessionId: `closed-${id}` }, lastModified: Date.now() / 1000 });
            window.testTabs = window.testTabs.filter(t => t.id !== id); window.chrome.tabs.onRemoved.emit(id);
          },
          create: async options => { window.calls.push(['create-tab', options]); },
          ...Object.fromEntries(['onMoved','onDetached','onAttached','onCreated','onRemoved','onUpdated','onActivated','onReplaced'].map(name => [name, event()]))
        }
      };
    };
    const selectWebsite = async (target, name) => { await target.getByRole('button', { name: '按网站筛选', exact: true }).click(); await target.getByRole('dialog', { name: '按网站筛选' }).getByRole('button', { name: new RegExp('^' + name.replaceAll('.', '\\.')) }).click(); };
    await page.addInitScript(setupBrowser);
    await page.goto(base + '/fixture');
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, 0, 640, 400); ctx.fillStyle = '#333'; ctx.font = '32px sans-serif'; ctx.fillText('Saved page preview', 40, 80);
      const request = indexedDB.open('keyval-store');
      request.onupgradeneeded = () => request.result.createObjectStore('keyval');
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const tx = db.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({ dataUrl: canvas.toDataURL(), timestamp: Date.now() }, 'https://github.com/page/1');
      await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    });
    await page.goto(base + '/overview/index.html');
    await page.locator('[data-tab-id="1"] .tab-screenshot').waitFor();
    assert.equal(await page.locator('.tab-count').innerText(), '120 个标签');
    assert((await page.locator('.tab-cell').count()) < 30, 'large lists remain virtualized');
    const cell = id => page.locator(`[data-tab-id="${id}"]`);
    const cardShadow = id => cell(id).locator('.tab-surface').evaluate(el => getComputedStyle(el).boxShadow);
    assert.equal(await cardShadow(1), await cardShadow(2), 'the active card has no extra highlight border on opening');
    assert.equal(await cell(1).locator('.tab-surface').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    const hoverCard = async id => {
      const box = await cell(id).locator('.tab-hit').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    };
    const scale = id => cell(id).locator('.tab-surface').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
    await hoverCard(1); await page.waitForTimeout(280);
    assert((await scale(1)) > 1.3);
    const bounds = await page.locator('.tab-viewport').boundingBox(), enlarged = await cell(1).locator('.tab-surface').boundingBox();
    assert(enlarged.x >= bounds.x && enlarged.y >= bounds.y, 'edge preview stays inside viewport');
    const movingControls = await cell(1).evaluate(el => {
      const surface = el.querySelector('.tab-surface'), close = el.querySelector('.tab-close'), label = el.querySelector('.tab-window-filter');
      const s = surface.getBoundingClientRect(), c = close.getBoundingClientRect();
      const zoom = new DOMMatrix(getComputedStyle(surface).transform).a;
      return { closeInside: surface.contains(close), labelInside: surface.contains(label), right: (s.right - c.right) / zoom, top: (c.top - s.top) / zoom, label: label.textContent };
    });
    assert(movingControls.closeInside && movingControls.labelInside, 'both controls share the card transform');
    assert(Math.abs(movingControls.right - 8) < 1 && Math.abs(movingControls.top - 8) < 1, 'close button keeps its corner inset while enlarged');
    assert.equal(movingControls.label, '窗口 1');
    const enlargedClose = await cell(1).locator('.tab-close').boundingBox();
    await page.mouse.move(enlargedClose.x + enlargedClose.width / 2, enlargedClose.y + enlargedClose.height / 2, { steps: 20 });
    assert(await cell(1).locator('.tab-close').evaluate(el => el.matches(':hover')), 'enlarged close is reachable with a continuous pointer path');
    assert.equal(await cell(1).getAttribute('data-expanded'), 'true', 'reaching close keeps the card expanded');
    await hoverCard(1);
    const enlargedLabel = await cell(1).locator('.tab-window-filter').boundingBox();
    await page.mouse.move(enlargedLabel.x + enlargedLabel.width / 2, enlargedLabel.y + enlargedLabel.height / 2, { steps: 20 });
    assert(await cell(1).locator('.tab-window-filter').evaluate(el => el.matches(':hover')), 'enlarged window filter is reachable with a continuous pointer path');
    assert.equal(await cell(1).getAttribute('data-expanded'), 'true', 'reaching the window label keeps the card expanded');
    await hoverCard(1); await page.waitForTimeout(280);
    const box2 = await cell(2).locator('.tab-hit').boundingBox();
    await page.mouse.move(box2.x + 2, box2.y + box2.height / 2); await page.waitForTimeout(55);
    assert((await scale(1)) > 1 && (await scale(2)) > 1, 'old and new card animate concurrently');
    assert.equal(await cell(2).locator('.tab-placeholder').count(), 1, 'missing thumbnails also enlarge');
    assert.equal(await cell(2).locator('.placeholder-title').innerText(), '页面 2 · 写作', 'a missing preview shows the real page title');
    assert.equal(await cell(2).locator('.placeholder-status').innerText(), '浏览后生成预览');
    assert.equal(await cell(1).locator('.thumbnail-badge').innerText(), '上次浏览');
    const firstScreenshot = await cell(1).locator('.tab-screenshot').getAttribute('src');
    const newScreenshot = await page.evaluate(async () => {
      const cache = await import('/cache-test.js');
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ccc'; ctx.fillRect(0, 0, 640, 400);
      const image = canvas.toDataURL();
      await cache.storeThumbnail('test-session', 1, window.testTabs[0].url, image);
      chrome.runtime.onMessage.emit({ type: 'mosaic:thumbnail-updated', tabId: 1, url: window.testTabs[0].url });
      return image;
    });
    assert.notEqual(firstScreenshot, newScreenshot);
    await page.waitForFunction(image => document.querySelector('[data-tab-id="1"] .tab-screenshot')?.getAttribute('src') === image, newScreenshot);
    assert.equal(await cell(1).locator('.thumbnail-badge').count(), 0, 'new screenshot replaces old cache without reopening overview');
    // New status notifications must not erase an existing same-URL image.
    await page.evaluate(() => {
      for (const id of [1, 2]) {
        const tab = window.testTabs.find(tab => tab.id === id);
        window.testSession['glimpse:preview:' + id] = { url: tab.url, status: 'permission', capturedAt: 1000, dirtyAt: 2000, failures: 1, blockedUntil: Date.now() + 300000 };
        chrome.runtime.onMessage.emit({ type: 'glimpse:preview-state', tabId: id, url: tab.url });
      }
    });
    await page.waitForFunction(() => document.querySelector('[data-tab-id="2"] .placeholder-status')?.textContent === '需要访问权限');
    assert.equal(await cell(1).locator('.tab-screenshot').getAttribute('src'), newScreenshot, 'capture errors preserve a usable image');
    assert.equal(await cell(1).locator('.thumbnail-badge').innerText(), '已保存预览');
    assert((await cell(2).locator('.tab-hit').getAttribute('aria-description')).includes('扩展详情'), 'permission state includes an actionable accessible hint');
    await page.evaluate(() => {
      window.testTabs[1].status = 'loading'; chrome.tabs.onUpdated.emit(2, { status: 'loading' }, window.testTabs[1]);
    });
    await page.waitForFunction(() => document.querySelector('[data-tab-id="2"] .placeholder-status')?.textContent === '页面加载中');
    await page.evaluate(() => {
      window.testTabs[1].status = 'complete'; chrome.tabs.onUpdated.emit(2, { status: 'complete' }, window.testTabs[1]);
      for (const id of [1, 2]) {
        delete window.testSession['glimpse:preview:' + id];
        chrome.runtime.onMessage.emit({ type: 'glimpse:preview-state', tabId: id, url: window.testTabs[id - 1].url });
      }
    });
    await page.waitForFunction(() => document.querySelector('[data-tab-id="2"] .placeholder-status')?.textContent === '浏览后生成预览');
    const queriesBeforeMetadata = await page.evaluate(() => window.tabQueries);
    await page.evaluate(() => {
      for (let i = 0; i < 40; i++) {
        window.testTabs[1].title = '增量更新标题 ' + i;
        chrome.tabs.onUpdated.emit(2, { title: window.testTabs[1].title }, window.testTabs[1]);
      }
      chrome.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    });
    await page.waitForFunction(() => document.querySelector('[data-tab-id="2"] .tab-title')?.textContent === '增量更新标题 39');
    assert.equal(await page.evaluate(() => window.tabQueries), queriesBeforeMetadata, 'title and activation events do not query every tab');
    await page.evaluate(() => chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 }));
    const queriesBeforeBurst = await page.evaluate(() => window.tabQueries);
    await page.evaluate(() => { for (let i = 0; i < 50; i++) chrome.tabs.onMoved.emit(2, { windowId: 1 }); });
    await page.waitForFunction(before => window.tabQueries > before, queriesBeforeBurst);
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.tabQueries), queriesBeforeBurst + 1, 'structural event burst coalesces into one query');
    const originalOrder = await page.locator('.tab-cell').evaluateAll(els => els.map(el => el.dataset.tabId));
    await page.evaluate(() => {
      window.lastFocusedWindow = 3;
      window.testTabs[0].index = 30;
      chrome.tabs.onMoved.emit(1, { windowId: 1, fromIndex: 0, toIndex: 30 });
      window.testTabs[1].title = '页面 2 · 更新后的标题'; chrome.tabs.onUpdated.emit(2);
    });
    await page.waitForFunction(() => document.querySelector('[data-tab-id="2"] .tab-title').textContent.includes('更新后'));
    assert.deepEqual(await page.locator('.tab-cell').evaluateAll(els => els.map(el => el.dataset.tabId)), originalOrder, 'focus, reordering and title updates keep card order');
    // Actual pointer sweeps, including reversal, must not be captured by enlarged neighbours.
    for (const id of [3, 2, 1, 2, 3]) {
      const b = await cell(id).locator('.tab-hit').boundingBox();
      await page.mouse.move(b.x + 3, b.y + b.height / 2);
      await page.waitForTimeout(35);
      assert(await cell(id).evaluate(el => el.dataset.expanded === 'true'));
    }
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    assert.equal(await scale(3), 1);
    await cell(2).locator('.tab-hit').focus(); await page.waitForTimeout(280);
    assert((await scale(2)) > 1.3, 'keyboard focus enlargement survives selection rerender');
    assert.equal(await cell(2).locator('.tab-surface').evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'focused card has no bright outline');
    await page.getByRole('searchbox').focus();
    assert.equal(await page.locator('.overview-search').evaluate(el => getComputedStyle(el).boxShadow), 'none', 'search focus has no inset ring');
    if (process.env.MOSAIC_SCREENSHOT) await page.screenshot({ path: process.env.MOSAIC_SCREENSHOT });
    await hoverCard(2); await page.mouse.down(); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.calls.filter(c => c[0] === 'select-tab').map(c => c[1])), [2], 'one click selects correct tab');
    await hoverCard(3); await page.waitForTimeout(280);
    const close3 = await cell(3).locator('.tab-close').boundingBox();
    await page.mouse.move(close3.x + close3.width / 2, close3.y + close3.height / 2, { steps: 20 });
    await page.mouse.down(); await page.mouse.up();
    await cell(3).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '按网站筛选', exact: true }).click();
    assert.deepEqual(await page.locator('.finder-menu [data-domain]').evaluateAll(els => els.map(el => el.dataset.domain)), ['docs.qq.com', 'github.com', 'mp.weixin.qq.com', 'zhihu.com'], 'changing counts never reshuffles website filters');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.calls.filter(c => c[0] === 'remove-tab').map(c => c[1])), [3]);
    assert.equal(await page.evaluate(() => window.calls.filter(c => c[0] === 'select-tab').length), 1, 'close does not select');
    await selectWebsite(page, 'github.com');
    assert.equal(await page.locator('.tab-count').innerText(), '30 个标签');
    assert(await page.locator('.tab-domain').evaluateAll(els => els.every(el => el.textContent === 'github.com')));
    await page.getByRole('searchbox').fill('不存在的内容xyz');
    await page.getByRole('button', { name: '清空搜索' }).click();
    await page.getByRole('button', { name: '清除网站和窗口筛选' }).click();
    assert.equal(await page.locator('.tab-count').innerText(), '119 个标签');
    if (process.env.MOSAIC_SCREENSHOT) await page.screenshot({ path: process.env.MOSAIC_SCREENSHOT });
    await page.getByRole('button', { name: /^撤销/ }).click();
    await page.waitForFunction(() => document.querySelector('.tab-count')?.textContent === '120 个标签');
    assert.deepEqual(await page.evaluate(() => window.calls.filter(c => c[0] === 'restore-session').map(c => c[1])), ['closed-3']);
    // Restore appends the new tab without moving cards already on screen.
    assert.deepEqual((await page.locator('.tab-cell').evaluateAll(els => els.slice(0, 3).map(el => el.dataset.tabId))), ['1', '2', '4']);
    const switchesBeforeFilter = await page.evaluate(() => window.calls.filter(c => c[0] === 'select-tab').length);
    await cell(2).getByRole('button', { name: '只看窗口 1' }).click();
    assert.equal(await page.locator('.tab-count').innerText(), '40 个标签');
    assert.equal(await page.evaluate(() => window.calls.filter(c => c[0] === 'select-tab').length), switchesBeforeFilter, 'window filter does not activate tab');
    await selectWebsite(page, 'github.com');
    assert.equal(await page.locator('.tab-count').innerText(), '10 个标签', 'domain and window filters compose');
    await page.getByRole('button', { name: '取消窗口 1 筛选' }).click();
    assert.equal(await page.locator('.tab-count').innerText(), '30 个标签');
    await page.getByRole('button', { name: '清除网站和窗口筛选' }).click();
    assert.equal(await page.locator('.tab-count').innerText(), '120 个标签');
    // Removing another window must not renumber survivors; filtering an empty window is reversible.
    await page.evaluate(() => { window.testTabs = window.testTabs.filter(t => t.windowId !== 2); chrome.tabs.onRemoved.emit(41); });
    await page.waitForFunction(() => document.querySelector('.tab-count')?.textContent === '80 个标签');
    await page.locator('.tab-viewport').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await cell(120).waitFor();
    assert.equal(await cell(120).getByRole('button', { name: '只看窗口 3' }).count(), 1);
    await cell(120).getByRole('button', { name: '只看窗口 3' }).click();
    assert.equal(await page.locator('.tab-count').innerText(), '40 个标签');
    await page.getByRole('button', { name: '清除网站和窗口筛选' }).click();
    await page.getByRole('searchbox').focus();
    const before = await page.evaluate(() => window.calls.length);
    await page.getByRole('searchbox').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
    assert.equal(await page.evaluate(() => window.calls.length), before, 'IME confirmation never selects a tab');
    await page.getByRole('searchbox').evaluate(el => el.blur());
    await page.keyboard.type('git');
    assert.equal(await page.getByRole('searchbox').inputValue(), 'git', 'type to search preserves first character');
    await page.getByRole('searchbox').fill('');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.glimpse-overview').getAttribute('data-keyboard-navigation'), 'true');
    assert.notEqual(await cell(1).locator('.tab-caption').evaluate(el => getComputedStyle(el).backgroundColor), await cell(2).locator('.tab-caption').evaluate(el => getComputedStyle(el).backgroundColor), 'arrow navigation remains visible in the caption');
    assert.equal(await cardShadow(1), await cardShadow(2), 'keyboard selection does not add a card border');
    await page.mouse.move(10, 10);
    assert.equal(await page.locator('.glimpse-overview').getAttribute('data-keyboard-navigation'), 'false', 'mouse browsing clears the keyboard indicator');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.calls.filter(c => c[0] === 'select-tab').at(-1)[1]), 2);
    // Same virtual cell navigates to an uncached URL: never retain the old screenshot.
    await page.evaluate(() => { window.testTabs[0].url = 'https://github.com/uncached'; chrome.tabs.onUpdated.emit(1); });
    await cell(1).locator('.tab-placeholder').waitFor();
    await page.locator('.tab-viewport').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await cell(120).waitFor();
    await hoverCard(120); await page.waitForTimeout(280);
    const bottom = await cell(120).locator('.tab-surface').boundingBox();
    assert(bottom.y + bottom.height <= bounds.y + bounds.height + 1, 'last row expands within scroll viewport');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await cell(120).locator('.tab-surface').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    for (const width of [360, 736, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(100);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `fits ${width}px`);
    }
    await page.locator('.tab-viewport').evaluate(el => { el.scrollTop = 0; });
    await cell(1).waitFor();
    // New tabs append rather than inserting at their browser tab-strip index.
    const stablePrefix = await page.locator('.tab-cell').evaluateAll(els => els.slice(0, 4).map(el => el.dataset.tabId));
    await page.evaluate(() => {
      const tab = { ...window.testTabs[0], id: 700, windowId: 4, index: 0, title: '新窗口唯一标签', url: 'https://unique.example/' };
      window.testTabs.unshift(tab); chrome.tabs.onCreated.emit(tab);
    });
    await page.waitForFunction(() => document.querySelector('.tab-count')?.textContent === '81 个标签');
    assert.deepEqual(await page.locator('.tab-cell').evaluateAll(els => els.slice(0, 4).map(el => el.dataset.tabId)), stablePrefix);
    await page.locator('.tab-viewport').evaluate(el => { el.scrollTop = el.scrollHeight; }); await cell(700).waitFor();
    await cell(700).getByRole('button', { name: '只看窗口 4' }).click();
    assert.equal(await page.locator('.tab-count').innerText(), '1 个标签');
    await cell(700).locator('.tab-close').focus(); await page.keyboard.press('Enter');
    await page.getByText('当前筛选范围内没有匹配的页面', { exact: false }).waitFor();
    await page.getByRole('button', { name: /^撤销/ }).click();
    await cell(1700).waitFor(); assert.equal(await page.locator('.tab-count').innerText(), '1 个标签');
    await page.getByRole('button', { name: '清除网站和窗口筛选' }).click();
    // Undo notification expires without moving the grid or leaving a stale button.
    await page.clock.install();
    await cell(1).locator('.tab-close').focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^撤销/ }).waitFor();
    await page.mouse.move(0, 0); await page.clock.fastForward(10500);
    assert.equal(await page.getByRole('button', { name: /^撤销/ }).count(), 0);
    await cell(2).locator('.tab-close').focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^撤销/ }).hover();
    await page.clock.fastForward(15000);
    assert.equal(await page.getByRole('button', { name: /^撤销/ }).count(), 1, 'undo stays available while hovered');
    await page.mouse.move(0, 0); await page.clock.fastForward(5100);
    assert.equal(await page.getByRole('button', { name: /^撤销/ }).count(), 0, 'leaving undo grants a grace period then expires');
    // Optional undo access must not block closing, and a successful retry clears the error.
    await page.evaluate(() => { window.failNextRemove = true; });
    await cell(4).locator('.tab-close').focus(); await page.keyboard.press('Enter');
    await page.getByText('浏览器未能关闭该标签页，请稍后重试。').waitFor();
    assert.equal(await cell(4).count(), 1, 'failed browser close retains the card');
    await page.evaluate(() => { delete chrome.sessions; });
    await cell(4).locator('.tab-close').focus(); await page.keyboard.press('Enter');
    await cell(4).waitFor({ state: 'detached' });
    assert.equal(await page.getByText('浏览器未能关闭该标签页，请稍后重试。').count(), 0);
    assert.equal(await page.evaluate(() => window.calls.filter(c => c[0] === 'remove-tab' && c[1] === 4).length), 1, 'missing sessions still removes the tab exactly once');
    const cacheResults = await page.evaluate(async () => {
      const cache = await import('/cache-test.js');
      const url = 'https://duplicate.example/same';
      await cache.storeThumbnail('test-session', 200, url, 'data:image/png;base64,aW1hZ2UtQQ==');
      await cache.storeThumbnail('test-session', 201, url, 'data:image/png;base64,aW1hZ2UtQg==');
      const a = await cache.getThumbnail(200, url), b = await cache.getThumbnail(201, url);
      const unseen = await cache.getThumbnail(202, url);
      window.testSession.thumbnailSession = 'next-session';
      const restored = await cache.getThumbnail(200, url);
      window.testSession.thumbnailSession = 'test-session';
      // Exercise resizing in an actual service worker rather than the page's DOM.
      const image = document.querySelector('.tab-screenshot')?.src;
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 800;
      const input = image || canvas.toDataURL();
      const registration = await navigator.serviceWorker.register('/resize-worker.js', { type: 'module' });
      const worker = registration.installing || registration.waiting || registration.active;
      if (worker.state !== 'activated') await new Promise(resolve => worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); }));
      const channel = new MessageChannel();
      const resized = await new Promise(resolve => { channel.port1.onmessage = e => resolve(e.data); worker.postMessage(input, [channel.port2]); });
      channel.port1.close(); await registration.unregister();
      const req = indexedDB.open('keyval-store');
      const db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
      const tx = db.transaction('keyval', 'readwrite');
      for (let i = 0; i < 550; i++) tx.objectStore('keyval').put({ dataUrl: 'image', timestamp: Date.now() }, `mosaic:url:test-${i}`);
      tx.objectStore('keyval').put({ dataUrl: 'expired', timestamp: Date.now() - 15 * 86400000 }, 'https://expired.example/');
      await new Promise(resolve => { tx.oncomplete = resolve; });
      const expired = await cache.getThumbnail(500, 'https://expired.example/');
      await cache.pruneThumbnails('test-session');
      const request = db.transaction('keyval').objectStore('keyval').count();
      const count = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
      db.close();
      return { a, b, unseen, restored, resized, expired, count, stats: await cache.getCacheStats() };
    });
    assert.equal(cacheResults.a.dataUrl, 'data:image/png;base64,aW1hZ2UtQQ=='); assert.equal(cacheResults.b.dataUrl, 'data:image/png;base64,aW1hZ2UtQg==');
    assert.equal(cacheResults.unseen, null, 'new same-URL tabs never borrow another live tab image');
    assert.equal(cacheResults.restored.previous, true, 'browser restart uses clearly marked previous-session image');
    assert.deepEqual(cacheResults.resized, { width: 640, height: 400, serviceWorker: true });
    assert.equal(cacheResults.expired, null); assert(cacheResults.stats.images <= 500); assert(cacheResults.stats.bytes <= cacheResults.stats.limit);
    const migration = await page.evaluate(async () => {
      const cache = await import('/cache-test.js'); await cache.clearThumbnails();
      window.testSession.thumbnailSession = 'test-session';
      const image = 'data:image/png;base64,aW1hZ2U=', url = 'https://legacy.test/page?q=1#x';
      const request = indexedDB.open('keyval-store'); const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
      const write = async pairs => { const tx = db.transaction('keyval','readwrite'); pairs.forEach(([key,value])=>tx.objectStore('keyval').put(value,key)); await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); };
      const readAll = async () => {const tx=db.transaction('keyval'); const request=tx.objectStore('keyval').getAll(); return new Promise(resolve=>{request.onsuccess=()=>resolve(request.result);});};
      const legacy={dataUrl:image,url,timestamp:Date.now(),session:'test-session',tabId:701};
      await write([['mosaic:tab:test-session:701',legacy],['mosaic:url:'+url,legacy]]);
      const nativePut=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,key){ if(typeof key==='string'&&key.startsWith('glimpse:image:'))throw new Error('simulated quota');return nativePut.call(this,value,key); };
      await cache.pruneThumbnails('test-session');
      IDBObjectStore.prototype.put=nativePut;
      const fallback=await cache.getThumbnail(701,url), failedValues=await readAll();
      await cache.pruneThumbnails('test-session'); const migrated=await readAll(), stats=await cache.getCacheStats();
      const exact=await cache.getThumbnail(701,url), unseen=await cache.getThumbnail(702,url);
      window.testSession.thumbnailSession='restart';const previous=await cache.getThumbnail(701,url);window.testSession.thumbnailSession='test-session';
      await cache.storeThumbnail('test-session',702,'https://kept.test/path',image);
      await cache.clearThumbnails('legacy.test');const removed=await cache.getThumbnail(701,url),kept=await cache.getThumbnail(702,'https://kept.test/path');
      const perSite=await cache.getCacheStats();
      await cache.clearThumbnails();const empty=await cache.getCacheStats();db.close();
      return {fallback,failedLegacy:failedValues.filter(value=>value.dataUrl).length,images:migrated.filter(value=>value.blob instanceof Blob).length,refs:migrated.filter(value=>value.imageId).map(value=>value.imageId),stats,exact,unseen,previous,removed,kept,perSite,empty};
    });
    assert.equal(migration.failedLegacy,2,'failed migration leaves both original records intact');
    assert.equal(migration.fallback.dataUrl,migration.exact.dataUrl);
    assert.equal(migration.images,1);assert.equal(new Set(migration.refs).size,1,'both indexes share one Blob');
    assert.equal(migration.stats.images,1);assert.equal(migration.unseen,null);assert(migration.previous.previous);
    assert.equal(migration.removed,null);assert(migration.kept);assert.equal(migration.perSite.sites.length,1);
    assert.equal(migration.empty.images,0);assert.equal(migration.empty.bytes,0,'clear removes indexes and images');
    assert.deepEqual(errors, []);
    const findPage = await browser.newPage({ viewport: { width: 1080, height: 900 } });
    await findPage.addInitScript(setupBrowser);
    await findPage.goto(base + '/overview/index.html');
    await findPage.locator('[data-tab-id="1"]').waitFor();
    await findPage.evaluate(() => {
      window.testTabs[0].title = '准备 设计评审 相关资料';
      window.testTabs[116].title = '设计评审';
      chrome.tabs.onUpdated.emit(1); chrome.tabs.onUpdated.emit(117);
    });
    await findPage.getByRole('searchbox').fill('设计评审');
    await findPage.waitForFunction(() => document.querySelector('.tab-cell')?.getAttribute('data-tab-id') === '117');
    assert.equal(await findPage.locator('[data-tab-id="117"] .tab-hit').getAttribute('aria-pressed'), 'true', 'exact title wins over the active, partial match');
    await findPage.keyboard.press('Enter');
    await findPage.waitForFunction(() => window.calls.some(call => call[0] === 'close-overview'));
    assert.equal(await findPage.evaluate(() => window.calls.find(call => call[0] === 'select-tab')[1]), 117);
    await findPage.keyboard.press('Escape');
    assert.equal(await findPage.getByRole('searchbox').inputValue(), '');
    await selectWebsite(findPage, 'github.com');
    await findPage.getByRole('searchbox').fill('没有这种标题xyz');
    const closedBeforeEscape = await findPage.evaluate(() => window.calls.filter(call => call[0] === 'close-overview').length);
    await findPage.keyboard.press('Escape');
    assert.equal(await findPage.locator('.tab-count').innerText(), '30 个标签', 'first Escape clears search within the chosen website');
    await findPage.getByRole('searchbox').dispatchEvent('keydown', { key: 'Escape', repeat: true, bubbles: true });
    assert.equal(await findPage.locator('.tab-count').innerText(), '30 个标签', 'holding Escape cannot accidentally clear every level');
    await findPage.keyboard.press('Escape');
    assert.equal(await findPage.locator('.tab-count').innerText(), '120 个标签', 'next Escape returns to all websites');
    assert.equal(await findPage.evaluate(() => window.calls.filter(call => call[0] === 'close-overview').length), closedBeforeEscape);
    await findPage.keyboard.press('Escape');
    await findPage.waitForFunction(count => window.calls.filter(call => call[0] === 'close-overview').length === count + 1, closedBeforeEscape);
    await findPage.locator('.tab-viewport').evaluate(el => { el.scrollTop = 1800; });
    await findPage.waitForFunction(() => window.testSession.mosaicOverviewPosition?.anchorIndex >= 12);
    const position = await findPage.evaluate(() => ({ top: document.querySelector('.tab-viewport').scrollTop, saved: window.testSession.mosaicOverviewPosition }));
    await findPage.evaluate(() => sessionStorage.setItem('mosaic-test-focused', '3'));
    await findPage.reload();
    await findPage.waitForFunction(top => Math.abs((document.querySelector('.tab-viewport')?.scrollTop ?? 0) - top) < 2, position.top);
    await findPage.waitForTimeout(250);
    assert(Math.abs(await findPage.locator('.tab-viewport').evaluate(el => el.scrollTop) - position.top) < 2, 'restored position survives initial saves');
    assert.deepEqual(await findPage.evaluate(() => window.testSession.mosaicOverviewPosition.order), position.saved.order, 'reopening after a window switch preserves card order');
    await findPage.locator(`[data-tab-id="${position.saved.anchorId}"]`).waitFor();
    assert.equal(await findPage.locator(`[data-tab-id="${position.saved.anchorId}"] .tab-hit`).getAttribute('aria-pressed'), 'true', 'keyboard selection returns to the visible anchor');
    assert.equal(await findPage.getByRole('searchbox').inputValue(), '', 'reopening starts with every tab searchable');
    await findPage.evaluate(() => {
      const privateTab = { ...window.testTabs[0], id: 900, incognito: true, title: 'Private tab' };
      window.testTabs.push(privateTab); chrome.tabs.onCreated.emit(privateTab);
    });
    await findPage.waitForFunction(() => document.querySelector('.tab-count')?.textContent === '121 个标签');
    await findPage.locator('.tab-viewport').evaluate(el => { el.scrollTop = 2400; });
    await findPage.waitForTimeout(200);
    assert.deepEqual(await findPage.evaluate(() => window.testSession.mosaicOverviewPosition.order), position.saved.order, 'private browsing never enters saved positions');
    await findPage.close();
    const finderPage = await browser.newPage({ viewport: { width: 1080, height: 900 } });
    finderPage.on('pageerror', error => errors.push(error.message));
    await finderPage.addInitScript(setupBrowser);
    await finderPage.addInitScript(() => {
      window.testTabs = window.testTabs.slice(0, 12).map((tab, index) => ({ ...tab, windowId: Math.floor(index / 4) + 1, lastAccessed: 1000 + index }));
      window.testTabs[0].title = '工程日志'; window.testTabs[0].pinned = true; window.testTabs[0].audible = true;
      window.testTabs[1].title = '产品设计评审'; window.testTabs[2].discarded = true;
    });
    await finderPage.goto(base + '/overview/index.html');
    await finderPage.locator('[data-tab-id="1"]').waitFor();
    assert((await finderPage.locator('[data-tab-id="1"] .tab-hit').getAttribute('aria-description')).includes('固定标签，正在发声'));
    assert.equal(await finderPage.locator('[data-tab-id="1"] .tab-hit').getAttribute('title'), '工程日志');
    const siteTrigger = finderPage.getByRole('button', { name: '按网站筛选', exact: true });
    await siteTrigger.focus(); await finderPage.keyboard.press('ArrowDown');
    const siteInput = finderPage.getByRole('searchbox', { name: '筛选网站' });
    assert(await siteInput.evaluate(el => el === document.activeElement), 'picker opens with focus in its own search');
    assert.equal(await siteInput.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'picker input has no bright focus outline');
    assert.equal(await siteTrigger.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'active picker trigger has no bright outline');
    await siteInput.fill('qq');
    assert.equal(await finderPage.locator('.finder-menu [data-domain]').count(), 2);
    const beforePicker = await finderPage.evaluate(() => window.calls.length);
    await siteInput.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
    assert.equal(await finderPage.getByRole('dialog', { name: '按网站筛选' }).count(), 1, 'IME Enter does not choose a site');
    assert.equal(await finderPage.evaluate(() => window.calls.length), beforePicker);
    await finderPage.keyboard.press('Escape');
    assert(await siteTrigger.evaluate(el => el === document.activeElement), 'Escape restores picker trigger focus');
    assert.equal(await finderPage.evaluate(() => window.calls.length), beforePicker, 'picker Escape cannot close overview');
    await siteTrigger.click(); await finderPage.keyboard.press('Control+f');
    assert.equal(await finderPage.getByRole('dialog', { name: '按网站筛选' }).count(), 0);
    assert(await finderPage.getByRole('searchbox', { name: '搜索标签页' }).evaluate(el => el === document.activeElement), 'global search shortcut also works from a picker');
    await selectWebsite(finderPage, 'github.com');
    const finderSearch = finderPage.getByRole('searchbox', { name: '搜索标签页' });
    await finderSearch.fill('产品设计评审');
    await finderPage.getByRole('button', { name: '在全部页面查找' }).click();
    assert.equal(await finderSearch.inputValue(), '产品设计评审', 'expanding scope preserves the query');
    assert.equal(await finderPage.locator('.tab-count').innerText(), '1 个标签');
    assert.equal(await finderPage.getByRole('button', { name: '排列方式', exact: true }).innerText(), '相关性');
    assert.equal(await finderPage.locator('[data-tab-id="2"] .tab-title mark').innerText(), '产品设计评审');
    assert.equal(await finderPage.getByRole('button', { name: '清除网站和窗口筛选' }).count(), 0);
    await finderSearch.fill('');
    await finderPage.getByRole('button', { name: '按窗口筛选', exact: true }).click();
    await finderPage.getByRole('searchbox', { name: '筛选窗口' }).fill('页面 5');
    await finderPage.getByRole('dialog', { name: '按窗口筛选' }).getByRole('button', { name: /^窗口 2/ }).click();
    assert.equal(await finderPage.locator('.tab-count').innerText(), '4 个标签');
    await finderPage.getByRole('button', { name: '取消窗口 2 筛选' }).click();
    await finderPage.getByRole('button', { name: '排列方式', exact: true }).click();
    await finderPage.getByRole('button', { name: '最近使用', exact: true }).click();
    await finderPage.waitForFunction(() => document.querySelector('.tab-cell')?.getAttribute('data-tab-id') === '12');
    const recentPrefix = await finderPage.locator('.tab-cell').evaluateAll(nodes => nodes.slice(0, 3).map(node => node.dataset.tabId));
    assert.deepEqual(recentPrefix, ['12', '11', '10']);
    await finderPage.evaluate(() => {
      window.testTabs.forEach(tab => { if (tab.windowId === 1) tab.active = tab.id === 2; });
      chrome.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    });
    await finderPage.waitForTimeout(120);
    assert.deepEqual(await finderPage.locator('.tab-cell').evaluateAll(nodes => nodes.slice(0, 3).map(node => node.dataset.tabId)), recentPrefix, 'recent order stays stable while overview is open');
    await finderPage.getByRole('button', { name: '排列方式', exact: true }).click();
    await finderPage.getByRole('button', { name: '原有顺序', exact: true }).click();
    await finderPage.waitForFunction(() => document.querySelector('.tab-cell')?.getAttribute('data-tab-id') === '1');
    const standardWidth = (await finderPage.locator('.tab-cell').first().boundingBox()).width;
    await finderPage.getByRole('button', { name: '更多选项', exact: true }).click();
    await finderPage.getByRole('button', { name: '紧凑', exact: true }).click();
    await finderPage.waitForFunction(() => document.querySelector('.glimpse-overview').dataset.density === 'compact');
    assert((await finderPage.locator('.tab-cell').first().boundingBox()).width < standardWidth);
    await finderPage.reload();
    await finderPage.waitForFunction(() => document.querySelector('.glimpse-overview')?.dataset.density === 'compact');
    assert.equal(await finderPage.evaluate(() => window.testLocal.glimpseDisplay.density), 'compact', 'display preference survives reopening');
    for (const viewport of [{ width: 360, height: 640 }, { width: 540, height: 360 }]) {
      await finderPage.setViewportSize(viewport);
      await finderPage.getByRole('button', { name: '更多选项', exact: true }).click();
      assert.equal(await finderPage.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'focused menu action has no outline');
      const popup = await finderPage.getByRole('dialog', { name: '更多选项' }).boundingBox();
      assert(popup.x >= 0 && popup.y >= 0 && popup.x + popup.width <= viewport.width && popup.y + popup.height <= viewport.height, 'popup stays inside narrow and short viewports');
      assert(await finderPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scrollbar with picker controls');
      if (process.env.GLIMPSE_FINDER_SCREENSHOT) await finderPage.screenshot({ path: process.env.GLIMPSE_FINDER_SCREENSHOT });
      await finderPage.keyboard.press('Escape');
    }
    await finderPage.close();
    const keywordPage = await browser.newPage({ viewport: { width: 1080, height: 900 } });
    keywordPage.on('pageerror', error => errors.push(error.message));
    await keywordPage.addInitScript(setupBrowser);
    await keywordPage.goto(base + '/overview/index.html');
    await keywordPage.locator('[data-tab-id="1"]').waitFor();
    await keywordPage.evaluate(() => {
      const titles = ['Claude Code 使用教程：从安装到实际开发', '我用 Claude Code 做了一个浏览器插件', '浏览器插件开发：如何保存页面截图', '视频生成工具使用体验', '星舟引擎安装指南', '星舟引擎性能测试', 'GPT-5.2 使用经验', 'Next.js App Router 文档'];
      window.testTabs = titles.map((title, i) => ({ ...window.testTabs[i], title, windowId: i < 4 ? 1 : 2 }));
      chrome.tabs.onUpdated.emit(1);
    });
    await keywordPage.waitForFunction(() => document.querySelector('.tab-count')?.textContent === '8 个标签');
    assert.equal(await keywordPage.locator('.search-keywords').count(), 1, 'keywords appear without focusing the input');
    assert.equal(await keywordPage.evaluate(() => document.activeElement.tagName), 'BODY');
    const keywordGrid = await keywordPage.locator('.tab-viewport').boundingBox();
    const keywordSearch = keywordPage.getByRole('searchbox');
    await keywordPage.locator('button.search-keyword').first().waitFor();
    assert(await keywordPage.locator('button.search-keyword').count() <= 8);
    assert.equal(await keywordPage.locator('.search-keywords').getByRole('button', { name: 'Claude Code', exact: true }).count(), 1);
    const searchBox = await keywordPage.locator('.overview-search').boundingBox();
    const keywordBox = await keywordPage.locator('.search-keywords').boundingBox();
    assert(searchBox.width <= 241, 'search input is narrower than the previous 480px');
    assert(keywordBox.x >= searchBox.x + searchBox.width && Math.abs(keywordBox.y + keywordBox.height / 2 - searchBox.y - searchBox.height / 2) < 1, 'keywords sit to the right of the search input on the same row');
    await keywordSearch.focus();
    assert.equal((await keywordPage.locator('.tab-viewport').boundingBox()).y, keywordGrid.y, 'suggestions do not shift the card grid');
    const keywordOrder = await keywordPage.locator('button.search-keyword').allTextContents();
    await keywordPage.evaluate(() => { window.testTabs[6].title = '天体摄影镜头评测'; chrome.tabs.onUpdated.emit(7); });
    await keywordPage.waitForFunction(() => document.querySelector('[data-tab-id="7"] .tab-title')?.textContent === '天体摄影镜头评测');
    const updatedKeywords = await keywordPage.locator('button.search-keyword').allTextContents();
    assert(!updatedKeywords.includes('GPT-5.2'), 'title updates replace stale keywords without requiring input focus');
    assert.deepEqual(updatedKeywords.filter(term => keywordOrder.includes(term)), keywordOrder.filter(term => updatedKeywords.includes(term)), 'surviving keywords retain their relative order');
    await keywordSearch.evaluate(el => el.blur());
    if (process.env.MOSAIC_KEYWORD_SCREENSHOT) await keywordPage.screenshot({ path: process.env.MOSAIC_KEYWORD_SCREENSHOT });
    await keywordPage.setViewportSize({ width: 860, height: 900 });
    const desktopMore = keywordPage.getByRole('button', { name: '更多快捷搜索词', exact: true });
    await desktopMore.click();
    const desktopTriggerBounds = await desktopMore.boundingBox();
    const desktopMenuBounds = await keywordPage.locator('.keyword-menu').boundingBox();
    const expectedMenuLeft = Math.max(12, Math.min(desktopTriggerBounds.x, 860 - desktopMenuBounds.width - 12));
    assert(Math.abs(desktopMenuBounds.x - expectedMenuLeft) < 1, 'overflow menu opens beside its trigger rather than the far edge of the keyword rail');
    assert(Math.abs(desktopMenuBounds.y - desktopTriggerBounds.y - desktopTriggerBounds.height - 8) < 1, 'overflow menu stays immediately below its trigger');
    if (process.env.MOSAIC_MENU_SCREENSHOT) await keywordPage.screenshot({ path: process.env.MOSAIC_MENU_SCREENSHOT });
    await keywordPage.keyboard.press('Escape');
    await keywordPage.setViewportSize({ width: 2000, height: 900 });
    await keywordPage.waitForFunction(() => [...document.querySelectorAll('button.search-keyword')].every(button => !button.hidden));
    assert.equal(await desktopMore.isVisible(), false, 'wide windows use available space instead of imposing a five-keyword limit');
    await keywordPage.setViewportSize({ width: 1080, height: 900 });
    await keywordPage.locator('.search-keywords').getByRole('button', { name: 'Claude Code', exact: true }).click();
    assert.equal(await keywordSearch.inputValue(), 'Claude Code');
    assert.equal(await keywordPage.locator('.tab-count').innerText(), '2 个标签');
    assert.equal(await keywordPage.locator('.search-keywords').count(), 1, 'keywords remain available while searching');
    assert.equal(await keywordPage.locator('.tab-cell.is-selected .tab-surface').evaluate(el => getComputedStyle(el).boxShadow), await keywordPage.locator('.tab-cell:not(.is-selected) .tab-surface').evaluate(el => getComputedStyle(el).boxShadow), 'search results have no default highlight border');
    assert.equal(await keywordPage.evaluate(() => window.calls.filter(call => call[0] === 'select-tab').length), 0, 'a keyword filters without activating a page');
    await keywordPage.keyboard.press('Enter');
    await keywordPage.waitForFunction(() => window.calls.some(call => call[0] === 'close-overview'));
    assert.equal(await keywordPage.evaluate(() => window.calls.find(call => call[0] === 'select-tab')[1]), 1);
    await keywordSearch.fill('');
    await keywordPage.keyboard.press('Tab');
    assert.equal(await keywordPage.evaluate(() => document.activeElement.className), 'search-keyword');
    await keywordPage.keyboard.press('ArrowRight');
    const focusedKeyword = await keywordPage.evaluate(() => document.activeElement.textContent);
    await keywordPage.keyboard.press('Enter');
    assert.equal(await keywordSearch.inputValue(), focusedKeyword, 'keyboard activation selects a keyword');
    assert.equal(await keywordPage.evaluate(() => document.activeElement.getAttribute('type')), 'search');
    await keywordPage.keyboard.press('Escape');
    await keywordPage.locator('[data-tab-id="5"]').getByRole('button', { name: '只看窗口 2' }).click();
    await selectWebsite(keywordPage, 'github.com');
    assert.equal(await keywordPage.locator('.tab-count').innerText(), '1 个标签');
    await keywordPage.locator('.search-keywords').getByRole('button', { name: 'Claude Code', exact: true }).click();
    assert.equal(await keywordPage.locator('.tab-count').innerText(), '2 个标签', 'global title keywords search across window and website filters');
    assert.equal(await keywordPage.locator('.active-window-filter').count(), 0);
    const keywordCloseCount = await keywordPage.evaluate(() => window.calls.filter(call => call[0] === 'close-overview').length);
    await keywordPage.keyboard.press('Escape');
    assert.equal(await keywordSearch.inputValue(), '', 'Escape clears the search without an extra popup-dismissal step');
    assert.equal(await keywordPage.locator('.search-keywords').count(), 1);
    assert.equal(await keywordPage.evaluate(() => window.calls.filter(call => call[0] === 'close-overview').length), keywordCloseCount);
    await keywordSearch.click();
    await keywordSearch.dispatchEvent('compositionstart');
    await keywordSearch.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
    assert.equal(await keywordPage.locator('.search-keywords').count(), 1, 'IME composition does not move the keywords');
    assert.equal(await keywordPage.evaluate(() => window.calls.filter(call => call[0] === 'close-overview').length), keywordCloseCount);
    await keywordSearch.dispatchEvent('compositionend');
    await keywordPage.setViewportSize({ width: 360, height: 780 });
    await keywordSearch.click();
    const narrowKeywords = await keywordPage.locator('.search-keywords').boundingBox();
    const narrowSearch = await keywordPage.locator('.overview-search').boundingBox();
    assert(narrowKeywords.x >= narrowSearch.x + narrowSearch.width && narrowKeywords.x + narrowKeywords.width <= 360, 'keywords stay to the right within a narrow window');
    assert(await keywordPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await keywordPage.locator('.search-keywords').evaluate(el => el.scrollWidth <= el.clientWidth), 'keywords do not require horizontal scrolling');
    const moreKeywords = keywordPage.getByRole('button', { name: '更多快捷搜索词', exact: true });
    await moreKeywords.click();
    const menuBounds = await keywordPage.locator('.keyword-menu').boundingBox();
    assert(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 360, 'overflow menu fits a narrow window');
    const narrowTriggerBounds = await moreKeywords.boundingBox();
    const narrowMenuLeft = Math.max(12, Math.min(narrowTriggerBounds.x, 360 - menuBounds.width - 12));
    assert(Math.abs(menuBounds.x - narrowMenuLeft) < 1, 'narrow windows keep the menu near the trigger while avoiding the viewport edge');
    if (process.env.MOSAIC_MENU_SCREENSHOT) await keywordPage.screenshot({ path: process.env.MOSAIC_MENU_SCREENSHOT.replace('.png', '-narrow.png') });
    const inlineTerms = await keywordPage.locator('button.search-keyword:visible').allTextContents();
    const menuTerms = await keywordPage.locator('.keyword-menu-item').allTextContents();
    assert.deepEqual([...inlineTerms, ...menuTerms], updatedKeywords, 'every extracted term remains accessible in order');
    assert.equal(await keywordPage.evaluate(() => document.activeElement.className), 'keyword-menu-item');
    await keywordPage.keyboard.press('End');
    const lastTerm = await keywordPage.locator('.keyword-menu-item').last().innerText();
    await keywordPage.keyboard.press('Enter');
    assert.equal(await keywordSearch.inputValue(), lastTerm, 'overflow terms use the same global search');
    await keywordSearch.fill('');
    await moreKeywords.focus(); await keywordPage.keyboard.press('ArrowDown');
    const closesBeforeMenuEscape = await keywordPage.evaluate(() => window.calls.filter(call => call[0] === 'close-overview').length);
    await keywordPage.keyboard.press('Escape');
    assert.equal(await keywordPage.locator('.keyword-menu').count(), 0);
    assert.equal(await keywordPage.evaluate(() => document.activeElement.className), 'keyword-more', 'Escape returns focus to the overflow trigger');
    assert.equal(await keywordPage.evaluate(() => window.calls.filter(call => call[0] === 'close-overview').length), closesBeforeMenuEscape, 'Escape dismisses the menu before clearing or closing');
    await moreKeywords.click();
    await keywordPage.getByRole('button', { name: '更多选项', exact: true }).focus();
    assert.equal(await keywordPage.locator('.keyword-menu').count(), 0, 'leaving the search controls dismisses the popup');
    if (process.env.MOSAIC_KEYWORD_SCREENSHOT) await keywordPage.screenshot({ path: process.env.MOSAIC_KEYWORD_SCREENSHOT.replace('.png', '-narrow.png') });
    await keywordPage.setViewportSize({ width: 1080, height: 900 });
    await keywordPage.evaluate(() => {
      window.testTabs.forEach((tab, index) => { tab.title = ['Architecture', 'Photography', 'TypeScript', 'Design'][index % 4]; });
      chrome.tabs.onUpdated.emit(1);
    });
    await keywordPage.waitForFunction(() => document.querySelectorAll('button.search-keyword:not([hidden])').length === 4 && document.querySelector('button.keyword-more')?.hidden);
    await keywordPage.locator('button.search-keyword').last().focus();
    await keywordPage.setViewportSize({ width: 360, height: 780 });
    await keywordPage.waitForFunction(() => document.activeElement?.className === 'keyword-more');
    assert.equal(await moreKeywords.isVisible(), true, 'shrinking transfers focus to the newly revealed overflow trigger');
    await keywordPage.evaluate(() => { window.testTabs.forEach(tab => { tab.title = '首页'; }); chrome.tabs.onUpdated.emit(1); });
    await keywordPage.locator('.search-keywords').waitFor({ state: 'detached' });
    assert.equal(await keywordPage.locator('.search-keywords').count(), 0, 'generic-only titles do not produce filler chips');
    await keywordPage.close();
    const latePage = await browser.newPage();
    await latePage.addInitScript(setupBrowser);
    await latePage.goto(base + '/overview/index.html?delayTabs=700');
    await latePage.evaluate(() => { window.testTabs.forEach((tab, i) => { tab.title = `Claude Code ${i}`; }); });
    await latePage.locator('button.search-keyword').first().waitFor();
    assert.equal(await latePage.locator('.tab-count').innerText(), '120 个标签', 'suggestions appear after delayed loading without an input gesture');
    await latePage.close();
    const batchPage = await browser.newPage({ viewport: { width: 1080, height: 900 } });
    batchPage.on('pageerror', error => errors.push(error.message));
    await batchPage.addInitScript(setupBrowser);
    await batchPage.goto(base + '/overview/index.html');
    await batchPage.locator('[data-tab-id="1"]').waitFor();
    const batchCard = id => batchPage.locator(`[data-tab-id="${id}"]`);
    const beforeSelectionGrid = await batchPage.locator('.tab-viewport').boundingBox();
    const beforeSelectionFilters = await batchPage.locator('.domain-filters').boundingBox();
    await batchPage.getByRole('button', { name: '多选', exact: true }).click();
    assert.deepEqual(await batchPage.locator('.tab-viewport').boundingBox(), beforeSelectionGrid, 'entering selection keeps the grid geometry unchanged');
    assert.deepEqual(await batchPage.locator('.domain-filters').boundingBox(), beforeSelectionFilters, 'batch controls have a reserved width so filters do not jump');
    await batchCard(1).getByRole('checkbox').click();
    await batchCard(2).getByRole('checkbox').click();
    assert.equal(await batchPage.locator('.selection-count').innerText(), '已选 2');
    assert.equal(await batchPage.evaluate(() => window.calls.some(call => call[0] === 'select-tab')), false, 'multiselect never opens pages');
    assert.equal(await batchPage.locator('.tab-close').count(), 0, 'selection mode exposes checks instead of individual close controls');
    if (process.env.MOSAIC_BATCH_SCREENSHOT) {
      await batchPage.mouse.move(0, 0); await batchPage.waitForTimeout(260);
      await batchPage.screenshot({ path: process.env.MOSAIC_BATCH_SCREENSHOT });
    }
    await batchPage.getByRole('button', { name: '关闭所选', exact: true }).dblclick();
    await batchPage.getByRole('button', { name: '撤销本次', exact: true }).waitFor();
    assert.deepEqual(await batchPage.evaluate(() => window.calls.filter(call => call[0] === 'remove-tab').map(call => call[1])), [1, 2], 'double activation executes one batch');
    assert.equal(await batchPage.evaluate(() => window.calls.filter(call => call[0] === 'move-tab').length), 0, 'the toolbar must not replace Close with Merge underneath a double click');
    await batchPage.getByRole('button', { name: '撤销本次', exact: true }).click();
    await batchPage.waitForFunction(() => document.querySelector('.tab-count').textContent === '120 个标签');
    assert.deepEqual(await batchPage.evaluate(() => window.calls.filter(call => call[0] === 'restore-session').map(call => call[1])), ['closed-1', 'closed-2']);
    await batchPage.getByRole('button', { name: '取消', exact: true }).click();
    await batchPage.getByRole('button', { name: '多选', exact: true }).click();
    await batchPage.getByRole('button', { name: '全选结果', exact: true }).click();
    assert.equal(await batchPage.locator('.selection-count').innerText(), '已选 120', 'select all includes virtualized offscreen cards');
    await selectWebsite(batchPage, 'github.com');
    assert.equal(await batchPage.locator('.selection-count').innerText(), '已选 0', 'changing filters clears hidden selections');
    await batchPage.getByRole('button', { name: '全选结果', exact: true }).click();
    assert.equal(await batchPage.locator('.selection-count').innerText(), '已选 30');
    await batchPage.getByRole('searchbox').fill('页面 9');
    assert.equal(await batchPage.locator('.selection-count').innerText(), '已选 0');
    await batchPage.getByRole('searchbox').fill('');
    await batchPage.getByRole('searchbox').press('ArrowDown');
    await batchPage.keyboard.press('Space');
    assert.equal(await batchPage.locator('.selection-count').innerText(), '已选 1');
    await batchPage.keyboard.press('Control+a');
    assert.equal(await batchPage.locator('.selection-count').innerText(), '已选 30');
    await batchPage.keyboard.press('Escape');
    assert.equal(await batchPage.getByRole('button', { name: '多选', exact: true }).count(), 1, 'Escape exits multiselect first');
    assert.equal(await batchPage.locator('.tab-count').innerText(), '30 个标签');
    await batchPage.getByRole('button', { name: '清除网站和窗口筛选' }).click();
    await batchPage.getByRole('button', { name: '多选', exact: true }).click();
    await batchCard(3).getByRole('checkbox').click(); await batchCard(4).getByRole('checkbox').click();
    await batchPage.evaluate(() => { window.failRemoveIds = [4]; });
    await batchPage.getByRole('button', { name: '关闭所选', exact: true }).click();
    await batchPage.getByText('已关闭 1 个标签，1 个未能关闭，可重试。').waitFor();
    assert.equal(await batchCard(4).getByRole('checkbox').getAttribute('aria-checked'), 'true');
    assert.equal(await batchPage.locator('.selection-count').innerText(), '已选 1');
    await batchPage.getByRole('button', { name: '取消', exact: true }).click();
    await batchPage.getByRole('button', { name: /^撤销/ }).click();
    await batchPage.waitForFunction(() => document.querySelector('.tab-count').textContent === '120 个标签');
    await selectWebsite(batchPage, 'github.com');
    await batchPage.getByRole('button', { name: '更多选项', exact: true }).click();
    await batchPage.getByRole('button', { name: '合并窗口', exact: true }).click();
    await batchPage.getByRole('button', { name: '合并所选窗口', exact: true }).click();
    await batchPage.getByRole('dialog', { name: '合并窗口', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await batchPage.locator('.undo-notice').innerText(), '已移动 80 个页面', JSON.stringify(await batchPage.evaluate(() => ({ error: document.querySelector('.overview-error')?.textContent, moved: window.calls.filter(call => call[0] === 'move-tab').length, windows: [...new Set(window.testTabs.map(tab => tab.windowId))] }))));
    assert.equal(await batchPage.evaluate(() => new Set(window.testTabs.map(tab => tab.windowId)).size), 1, 'merge includes all windows even with a website filter active');
    assert.equal(await batchPage.evaluate(() => window.calls.filter(call => call[0] === 'move-tab').length), 80);
    await batchPage.getByRole('button', { name: '更多选项', exact: true }).click();
    await batchPage.getByRole('button', { name: '合并窗口', exact: true }).click();
    await batchPage.getByText('0 个页面将移动', { exact: true }).waitFor();
    assert(await batchPage.getByRole('button', { name: '合并所选窗口', exact: true }).isDisabled());
    await batchPage.keyboard.press('Escape');
    assert.equal(await batchPage.evaluate(() => window.calls.filter(call => call[0] === 'move-tab').length), 80);
    await batchPage.setViewportSize({ width: 360, height: 780 });
    await batchPage.getByRole('button', { name: '多选', exact: true }).click();
    assert(await batchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'batch controls fit narrow windows');
    await batchPage.close();
    assert.deepEqual(errors, []);
    const toolsPage = await browser.newPage({ viewport: { width: 1080, height: 820 } });
    toolsPage.on('pageerror', error => errors.push(error.message));
    await toolsPage.addInitScript(setupBrowser);
    await toolsPage.addInitScript(() => {
      window.testTabs = window.testTabs.slice(0,12).map((tab,i)=>({...tab,windowId:Math.floor(i/4)+1,groupId:-1}));
      window.testTabs[1].url=window.testTabs[0].url;window.testTabs[2].url=window.testTabs[0].url;
      window.testTabs[0].pinned=true;window.testTabs[1].audible=true;
    });
    await toolsPage.goto(base+'/overview/index.html');await toolsPage.locator('[data-tab-id="1"]').waitFor();
    const openTool = async name => {await toolsPage.getByRole('button',{name:'更多选项',exact:true}).click();await toolsPage.getByRole('button',{name,exact:true}).click();};
    await openTool('检查重复页面');
    let dialog=toolsPage.getByRole('dialog',{name:'检查重复页面',exact:true});
    assert.equal(await dialog.getByRole('checkbox').count(),3);
    assert.equal(await dialog.locator('input:checked').count(),1,'protected copies not default selected');
    assert.equal(await dialog.locator('input:checked').getAttribute('aria-label'),'关闭副本：页面 3 · 项目');
    await dialog.getByRole('button',{name:'关闭所选副本',exact:true}).click();await dialog.waitFor({state:'detached'});
    assert.deepEqual(await toolsPage.evaluate(()=>window.calls.filter(c=>c[0]==='remove-tab').map(c=>c[1])),[3]);
    await toolsPage.getByRole('button',{name:/^撤销/}).click();await toolsPage.locator('[data-tab-id="1003"]').waitFor();
    await toolsPage.getByRole('button',{name:'多选',exact:true}).click();await toolsPage.locator('[data-tab-id="4"]').getByRole('checkbox').click();
    await toolsPage.getByRole('button',{name:'移动所选',exact:true}).click();
    dialog=toolsPage.getByRole('dialog',{name:'移动所选页面',exact:true});await dialog.getByLabel('目标窗口',{exact:true}).selectOption('2');
    assert.equal(await dialog.getByLabel('目标窗口',{exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    await dialog.getByRole('button',{name:'移动页面',exact:true}).click();await dialog.waitFor({state:'detached'});
    assert.equal(await toolsPage.evaluate(()=>window.testTabs.find(t=>t.id===4).windowId),2);assert.equal(await toolsPage.evaluate(()=>window.calls.filter(c=>c[0]==='move-tab').length),1);
    await toolsPage.getByRole('button',{name:'取消',exact:true}).click();
    await openTool('合并窗口');dialog=toolsPage.getByRole('dialog',{name:'合并窗口',exact:true});
    await dialog.getByLabel('目标窗口',{exact:true}).selectOption('1');
    await dialog.locator('label').filter({hasText:/^窗口 3/}).getByRole('checkbox').uncheck();
    assert((await dialog.innerText()).includes('5 个页面将移动'));
    await dialog.getByRole('button',{name:'合并所选窗口',exact:true}).click();await dialog.waitFor({state:'detached'});
    assert.equal(await toolsPage.evaluate(()=>window.testTabs.filter(t=>t.windowId===3).length),4,'unselected source window unchanged');
    await openTool('设置');dialog=toolsPage.getByRole('dialog',{name:'设置',exact:true});
    await dialog.getByRole('checkbox',{name:/随浏览自动更新/}).uncheck();
    await toolsPage.waitForFunction(()=>window.testLocal.glimpsePreviewSettings?.paused);
    await dialog.getByRole('checkbox',{name:'悬停放大预览',exact:true}).uncheck();
    await toolsPage.waitForFunction(()=>window.testLocal.glimpsePreviewSettings?.hoverPreview===false);
    await dialog.getByRole('textbox',{name:'排除网站',exact:true}).fill('https://github.com/some/path');
    await dialog.getByRole('button',{name:'添加',exact:true}).click();
    await dialog.getByRole('button',{name:'移除排除网站 github.com',exact:true}).waitFor();
    await toolsPage.waitForFunction(()=>window.testLocal.glimpsePreviewSettings?.excludedHosts.includes('github.com'));
    assert.deepEqual(await toolsPage.evaluate(()=>window.testLocal.glimpsePreviewSettings.excludedHosts),['github.com']);
    for(const viewport of [{width:360,height:640},{width:540,height:360}]){
      await toolsPage.setViewportSize(viewport);
      await toolsPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const box=await dialog.boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,'settings fits narrow/short viewport');
      assert(await toolsPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await toolsPage.waitForFunction(()=>document.querySelector('dialog')?.getAttribute('aria-busy')==='false');
      await dialog.getByRole('button',{name:'关闭面板',exact:true}).focus();await toolsPage.keyboard.press('Shift+Tab');
      assert(await toolsPage.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),'modal traps focus');
    }
    if(process.env.GLIMPSE_SETTINGS_SCREENSHOT){await toolsPage.setViewportSize({width:1080,height:820});await toolsPage.screenshot({path:process.env.GLIMPSE_SETTINGS_SCREENSHOT});}
    await toolsPage.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    assert(await toolsPage.getByRole('button',{name:'更多选项',exact:true}).evaluate(el=>el===document.activeElement),'dialog restores trigger focus');
    assert.equal(await toolsPage.evaluate(()=>window.calls.filter(c=>c[0]==='close-overview').length),0,'dialog Escape leaves overview open');
    await toolsPage.setViewportSize({width:1080,height:820});
    await toolsPage.locator('[data-tab-id="1"] .placeholder-status').getByText('已排除预览').waitFor();
    const noZoom=toolsPage.locator('[data-tab-id="1"] .tab-surface');await noZoom.hover();await toolsPage.waitForTimeout(280);
    assert.equal(await noZoom.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a),1,'hover preference disables enlargement');
    await toolsPage.reload();await toolsPage.waitForFunction(()=>document.querySelector('main')?.dataset.hoverPreview==='false');
    await openTool('设置');dialog=toolsPage.getByRole('dialog',{name:'设置',exact:true});
    assert.equal(await dialog.getByRole('checkbox',{name:/随浏览自动更新/}).isChecked(),false);
    await dialog.getByRole('button',{name:'移除排除网站 github.com',exact:true}).click();
    await dialog.getByRole('button',{name:'移除排除网站 github.com',exact:true}).waitFor({state:'detached'});
    await dialog.getByRole('checkbox',{name:/随浏览自动更新/}).check();
    await dialog.getByRole('button',{name:'刷新活动页面预览',exact:true}).click();await dialog.getByText('已安排刷新 1 个窗口的活动页面。').waitFor();
    await toolsPage.close();
    assert.deepEqual(errors, []);
    console.log('PASS: overview interactions, searchable pickers, IME/focus/Escape, search scope/highlights, recent snapshots, density persistence, narrow layouts, undo/batch actions, thumbnails and cache isolation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
