import type { TabInfo } from './tabManager';
import { tabDomain } from './tabDomain';

/** Keep surviving cards in place and append new tabs during one overview lifetime. */
export function reconcileTabs(previous: TabInfo[], incoming: TabInfo[]): TabInfo[] {
  const remaining = new Map(incoming.map(tab => [tab.id, tab]));
  const result: TabInfo[] = [];
  for (const old of previous) {
    const current = remaining.get(old.id);
    if (current) { result.push(current); remaining.delete(old.id); }
  }
  return [...result, ...remaining.values()];
}

export function reconcileWindowNumbers(previous: Map<number, number>, tabs: TabInfo[]): Map<number, number> {
  const result = new Map(previous);
  let next = Math.max(0, ...result.values()) + 1;
  for (const id of [...new Set(tabs.map(tab => tab.windowId))].sort((a, b) => a - b)) {
    if (!result.has(id)) result.set(id, next++);
  }
  return result;
}

export function reconcileDomainOrder(previous: string[], tabs: TabInfo[]): string[] {
  const counts = new Map<string, number>();
  for (const tab of tabs) { const name = tabDomain(tab.url); counts.set(name, (counts.get(name) ?? 0) + 1); }
  const known = new Set(previous);
  const added = [...counts.keys()].filter(name => !known.has(name))
    .sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  return [...previous, ...added];
}
