import type { TabInfo } from './tabManager';

const KEY = 'mosaicOverviewPosition';
const MAX_AGE = 30 * 60 * 1000;

export interface OverviewPosition {
  savedAt: number;
  order: number[];
  windows: [number, number][];
  anchorId: number;
  anchorIndex: number;
  rowOffset: number;
}

export async function readOverviewPosition(): Promise<OverviewPosition | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      chrome.storage.session.get(KEY),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 300); })
    ]);
    const value = result?.[KEY] as OverviewPosition | undefined;
    if (!value || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt < 0 || Date.now() - value.savedAt > MAX_AGE ||
      !Array.isArray(value.order) || !value.order.length || !value.order.every(Number.isInteger) ||
      !Array.isArray(value.windows) || !value.windows.every((entry: unknown) => Array.isArray(entry) && entry.length === 2 && entry.every(Number.isInteger)) ||
      !Number.isInteger(value.anchorId) || !Number.isInteger(value.anchorIndex) || value.anchorIndex < 0 ||
      !Number.isFinite(value.rowOffset) || value.rowOffset < 0) return null;
    return value as OverviewPosition;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function saveOverviewPosition(position: OverviewPosition | null): Promise<void> {
  if (!position) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      chrome.storage.session.set({ [KEY]: position }),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 300); })
    ]);
  }
  catch { /* Navigation must work even when session storage is unavailable. */ }
  finally { clearTimeout(timer); }
}

export function orderFromPosition(tabs: TabInfo[], saved: OverviewPosition | null): TabInfo[] {
  if (!saved) return tabs;
  const remaining = new Map(tabs.map(tab => [tab.id, tab]));
  const ordered: TabInfo[] = [];
  for (const id of saved.order) {
    const tab = remaining.get(id);
    if (tab) { ordered.push(tab); remaining.delete(id); }
  }
  return [...ordered, ...remaining.values()];
}

export function scrollFromPosition(saved: OverviewPosition, tabs: TabInfo[], columns: number, rowHeight: number): number {
  const found = tabs.findIndex(tab => tab.id === saved.anchorId);
  const index = found >= 0 ? found : Math.max(0, Math.min(saved.anchorIndex, tabs.length - 1));
  return Math.floor(index / columns) * rowHeight + Math.min(saved.rowOffset, rowHeight - 1);
}
