import Fuse from 'fuse.js';
import type { TabInfo } from './tabManager';
import { tabDomain } from './tabDomain';

type SearchTab = Pick<TabInfo, 'id' | 'title' | 'url'>;
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase();

export class TabSearchIndex {
  private source: { item: SearchTab; title: string; domain: string; url: string }[];
  private fuzzy: Fuse<SearchTab>;
  constructor(tabs: SearchTab[]) {
    this.source = tabs.map(item => ({ item, title: normalize(item.title), domain: normalize(tabDomain(item.url)), url: normalize(item.url) }));
    this.fuzzy = new Fuse(tabs, { keys: [{ name: 'title', weight: 2 }, { name: 'url', weight: 1 }], threshold: 0.3, ignoreLocation: true,
      getFn: (tab, path) => normalize((Array.isArray(path) ? path[0] : path) === 'title' ? tab.title : tab.url) });
  }
  search(query: string): { item: SearchTab }[] {
    const term = normalize(query.trim());
    if (!term) return [];
    const words = term.split(/\s+/u), exact: SearchTab[] = [], allWords: SearchTab[] = [], included = new Set<number>();
    for (const tab of this.source) {
      if (tab.title === term || tab.domain === term) { exact.push(tab.item); included.add(tab.item.id); }
      else if (words.every(word => tab.title.includes(word) || tab.url.includes(word))) { allWords.push(tab.item); included.add(tab.item.id); }
    }
    return [...exact, ...allWords].map(item => ({ item })).concat(this.fuzzy.search(term).filter(result => !included.has(result.item.id)).map(({ item }) => ({ item })));
  }
}

/** Only searchable fields invalidate the index; IDs resolve to current tab metadata. */
export function createTabSearchProvider() {
  let source: SearchTab[] = [], index: TabSearchIndex | undefined;
  return (tabs: TabInfo[]) => {
    if (!index || source.length !== tabs.length || source.some((tab, i) => tab.id !== tabs[i].id || tab.title !== tabs[i].title || tab.url !== tabs[i].url)) {
      source = tabs.map(({ id, title, url }) => ({ id, title, url }));
      index = new TabSearchIndex(source);
    }
    return index;
  };
}

/** Map normalized matches back to the original graphemes, including full-width text. */
export function searchHighlights(text: string, query: string): [number, number][] {
  const words = normalize(query.trim()).split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  let normalized = '';
  const offsets: [number, number][] = [];
  for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const part = normalize(segment);
    normalized += part;
    for (let i = 0; i < part.length; i++) offsets.push([index, index + segment.length]);
  }
  const ranges: [number, number][] = [];
  for (const word of words) {
    for (let start = normalized.indexOf(word); start >= 0; start = normalized.indexOf(word, start + word.length)) {
      ranges.push([offsets[start][0], offsets[start + word.length - 1][1]]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push([...range]);
  }
  return merged;
}
