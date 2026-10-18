import type { TabInfo } from './tabManager';
export type TabOrder = 'original' | 'recent';
export type CardDensity = 'standard' | 'compact';
const DISPLAY_KEY = 'glimpseDisplay';

export function recentTabOrder(tabs: TabInfo[]): number[] {
  return [...tabs].sort((a, b) => {
    const aTime = Number.isFinite(a.lastAccessed) && a.lastAccessed! > 0 ? a.lastAccessed! : 0;
    const bTime = Number.isFinite(b.lastAccessed) && b.lastAccessed! > 0 ? b.lastAccessed! : 0;
    return bTime - aTime || (!aTime && !bTime ? Number(b.active) - Number(a.active) : 0);
  }).map(tab => tab.id);
}
export function tabsInSnapshotOrder(tabs: TabInfo[], snapshot: number[]): TabInfo[] {
  const remaining = new Map(tabs.map(tab => [tab.id, tab]));
  const ordered: TabInfo[] = [];
  for (const id of snapshot) { const tab = remaining.get(id); if (tab) { ordered.push(tab); remaining.delete(id); } }
  return [...ordered, ...remaining.values()];
}
export async function readCardDensity(): Promise<CardDensity> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([chrome.storage.local.get(DISPLAY_KEY), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 300); })]);
    const value = result?.[DISPLAY_KEY];
    return value && typeof value === 'object' && 'density' in value && value.density === 'compact' ? 'compact' : 'standard';
  } catch { return 'standard'; }
  finally { clearTimeout(timer); }
}
export async function saveCardDensity(density: CardDensity): Promise<boolean> {
  try { await chrome.storage.local.set({ [DISPLAY_KEY]: { density } }); return true; }
  catch { return false; }
}
