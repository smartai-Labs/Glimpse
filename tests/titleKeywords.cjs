const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../src/lib/titleKeywords.ts')], bundle: true, format: 'iife', globalName: 'Keywords', write: false }).outputFiles[0].text;
const context = vm.createContext({ Intl, URL });
vm.runInContext(code, context);
const { extractTitleKeywords, createTitleKeywordProvider } = context.Keywords;
const sources = titles => titles.map((title, index) => ({ title, url: `https://example.com/page/${index}` }));
const titles = [
  'Claude Code 使用教程：从安装到实际开发',
  '我用 Claude Code 做了一个浏览器插件',
  '浏览器插件开发：如何保存页面截图',
  '视频生成工具使用体验',
  '星舟引擎安装指南',
  '星舟引擎性能测试',
  'GPT-5.2 使用经验',
  'Next.js App Router 文档'
];
const result = extractTitleKeywords(sources(titles));
const terms = Array.from(result, item => item.term);
for (const phrase of ['Claude Code', '浏览器插件', '视频生成', '星舟引擎', 'GPT-5.2', 'Next.js App Router']) assert(terms.includes(phrase), `keeps complete phrase: ${phrase}`);
assert(!terms.includes('Claude') && !terms.includes('Code'), 'phrase components do not repeat the same search');
assert(result.length <= 8);
assert.equal(result.find(item => item.term === '浏览器插件').documentCount, 2);

const duplicates = extractTitleKeywords([...sources(titles.slice(0, 3)), ...Array.from({ length: 50 }, (_, i) => ({ title: 'Banana Recipes', url: `https://food.test/${i}` }))]);
assert.equal(duplicates.find(item => item.term === 'Banana Recipes').documentCount, 1, 'identical titles cannot inflate popularity');
assert.equal(duplicates[0].documentCount, 2);
const sameUrl = extractTitleKeywords([{ title: 'Orion 安装指南', url: 'https://orion.test/a' }, { title: 'Orion 使用教程', url: 'https://orion.test/a' }]);
assert.equal(sameUrl[0].documentCount, 1, 'duplicate page URLs are counted once');
const routed = extractTitleKeywords([{ title: 'Orion 安装指南', url: 'https://orion.test/#/one' }, { title: 'Orion 使用教程', url: 'https://orion.test/#/two' }]);
assert.equal(routed[0].documentCount, 2, 'distinct hash-routed pages remain searchable sources');

const suffix = extractTitleKeywords(sources(['量子芯片进展 - 枫叶知识站', '固态电池研究 - 枫叶知识站', '蛋白质结构解析 - 枫叶知识站']));
assert(suffix.length > 0 && suffix.every(item => !/枫叶|知识站/.test(item.term)), 'learns repeated website suffixes without predefined topic names');
assert.equal(extractTitleKeywords(sources(['(99) 首页 | example.com', '登录 - example.com', '官方网站', '2026 09 26'])).length, 0, 'generic titles need no filler suggestions');
const mixed = extractTitleKeywords(sources(['Ｃｌａｕｄｅ Ｃｏｄｅ 入门', 'claude code 使用经验', 'C++ 指南', 'C# 文档']));
assert(mixed.some(item => item.term === 'Claude Code' && item.documentCount === 2), 'fullwidth and case variants share support');
assert(mixed.some(item => item.term === 'C++') && mixed.some(item => item.term === 'C#'));
assert(extractTitleKeywords(sources(['<script>alert(1)</script>', '😀😀😀', '']), 0).length === 0);
const provider = createTitleKeywordProvider();
const first = provider(sources(titles));
assert.equal(provider(sources(titles).map(item => ({ ...item, active: true }))), first, 'non-title updates reuse cached extraction');
const updated = provider(sources([...titles, '天体摄影实拍']));
assert.notEqual(updated, first);
const firstTerms = Array.from(first, item => item.term), updatedTerms = Array.from(updated, item => item.term);
assert.deepEqual(updatedTerms.filter(term => firstTerms.includes(term)), firstTerms.filter(term => updatedTerms.includes(term)), 'live updates keep surviving keyword order');
const many = sources(Array.from({ length: 1000 }, (_, i) => `${titles[i % titles.length]} ${i}`));
const start = performance.now();
assert(extractTitleKeywords(many).length <= 8);
console.log(`PASS: dynamic phrases, mixed scripts, new names, duplicate/suffix cleanup, empty states, stable cache; 1,000-title extraction ${Math.round(performance.now() - start)} ms.`);
