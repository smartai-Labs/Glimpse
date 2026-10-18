import type { TabInfo } from './tabManager';
import { closeWithUndo } from './undoClose';
import type { ClosedTab } from './undoClose';

export interface BrowserWindow { id: number; incognito: boolean; tabs: TabInfo[] }
export async function getBrowserWindows(tabs: TabInfo[]): Promise<BrowserWindow[]> {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  return windows.filter(window => window.type === 'normal' && window.id !== undefined)
    .map(window => ({ id: window.id!, incognito: !!window.incognito, tabs: tabs.filter(tab => tab.windowId === window.id) }));
}
export function partialGroupCount(selected: readonly TabInfo[], all: readonly TabInfo[]) {
  const ids = new Set(selected.map(tab => tab.id));
  const groups = new Set(selected.filter(tab => (tab.groupId ?? -1) >= 0).map(tab => tab.groupId));
  return [...groups].filter(id => all.some(tab => tab.groupId === id && !ids.has(tab.id))).length;
}
export interface MovePlan { tab: TabInfo; target: number | 'new' }
export interface MoveResult { moved: number; failedIds: number[]; skipped: number }
/** A frozen list of IDs: late arrivals and tabs the user moved elsewhere are never swept in. */
export async function moveTabs(plans: readonly MovePlan[], progress: (done: number, total: number) => void): Promise<MoveResult> {
  const unique = [...new Map(plans.map(plan => [plan.tab.id, plan])).values()];
  const attempted = new Set<number>(), destinations = new Map<number, number>(), accepted = new Set<number>();
  const newWindows = new Map<boolean, { id: number; blank?: number }>();
  const failed = new Set<number>(); let skipped = 0;
  const extensionUrl = chrome.runtime.getURL('');
  for (const plan of unique) {
    if (attempted.has(plan.tab.id)) continue;
    let unit = [plan];
    try {
      const live = await chrome.tabs.get(plan.tab.id).catch(() => null);
      if (!live) { skipped++; attempted.add(plan.tab.id); progress(attempted.size, unique.length); continue; }
      if (live.windowId !== plan.tab.windowId || !!live.incognito !== !!plan.tab.incognito || (live.url ?? '').startsWith(extensionUrl)) throw new Error('Page changed');
      if (plan.tab.groupId !== undefined && live.groupId !== plan.tab.groupId) throw new Error('Group changed');
      const source = await chrome.windows.get(live.windowId);
      if (source.type !== 'normal') throw new Error('Only normal windows');
      let target = plan.target;
      if (target === live.windowId) { skipped++; attempted.add(live.id!); progress(attempted.size, unique.length); continue; }
      let group: chrome.tabs.Tab[] = [];
      if ((live.groupId ?? -1) >= 0) {
        group = await chrome.tabs.query({ groupId: live.groupId });
        const members = new Set(group.map(tab => tab.id));
        const plannedGroup = unique.filter(item => !attempted.has(item.tab.id) && members.has(item.tab.id) && item.target === plan.target && item.tab.windowId === live.windowId);
        if (group.length && plannedGroup.length === group.length) unit = plannedGroup;
      }
      if (target === 'new') {
        const privacy = !!live.incognito;
        if (!newWindows.has(privacy)) {
          const created = await chrome.windows.create({ url: 'about:blank', type: 'normal', incognito: privacy, focused: false });
          if (created?.id === undefined) throw new Error('Window not created');
          newWindows.set(privacy, { id: created.id, blank: created.tabs?.find(tab => tab.url === 'about:blank' || tab.pendingUrl === 'about:blank')?.id });
        }
        target = newWindows.get(privacy)!.id;
      }
      const destination = await chrome.windows.get(target);
      if (destination.type !== 'normal' || !!destination.incognito !== !!live.incognito) throw new Error('Window changed');
      // Recheck after asynchronous window creation, before moving an intact group.
      const latest = await chrome.tabs.get(plan.tab.id);
      if (latest.windowId !== live.windowId || latest.groupId !== live.groupId) throw new Error('Page moved');
      if (group.length && unit.length === group.length) {
        const current = await chrome.tabs.query({ groupId: live.groupId });
        const ids = new Set(unit.map(item => item.tab.id));
        if (current.length !== ids.size || current.some(tab => !ids.has(tab.id!) || tab.windowId !== live.windowId)) throw new Error('Group changed');
        await chrome.tabGroups.move(live.groupId!, { windowId: target, index: -1 });
      } else {
        const index = latest.pinned ? (await chrome.tabs.query({ windowId: target, pinned: true })).length : -1;
        // Chrome detaches only this tab from its old group when moving across windows.
        await chrome.tabs.move(live.id!, { windowId: target, index });
        // Chrome may clear pinned when crossing windows even with a pinned-slot index.
        const moved = await chrome.tabs.get(live.id!);
        if (moved.windowId !== target) throw new Error('Move did not complete');
        if (!!moved.pinned !== !!latest.pinned) await chrome.tabs.update(live.id!, { pinned: !!latest.pinned });
        const confirmed = await chrome.tabs.get(live.id!);
        if (confirmed.windowId !== target || !!confirmed.pinned !== !!latest.pinned) throw new Error('Move state changed');
      }
      for (const item of unit) { accepted.add(item.tab.id); destinations.set(item.tab.id, target); }
    } catch { unit.forEach(item => failed.add(item.tab.id)); }
    unit.forEach(item => attempted.add(item.tab.id)); progress(attempted.size, unique.length);
  }
  // Remove only our own untouched placeholder. User-created/navigated pages are retained.
  for (const window of newWindows.values()) if (window.blank !== undefined) {
    const blank = await chrome.tabs.get(window.blank).catch(() => null);
    if (blank?.windowId === window.id && blank.url === 'about:blank' && !blank.pendingUrl && !blank.pinned) await chrome.tabs.remove(window.blank).catch(() => {});
  }
  let moved = 0;
  for (const id of accepted) {
    const live = await chrome.tabs.get(id).catch(() => null);
    if (live?.windowId === destinations.get(id)) moved++;
    else if (!live) skipped++; else failed.add(id);
  }
  return { moved, skipped, failedIds: [...failed] };
}

export interface DuplicateGroup { key: string; url: string; tabs: TabInfo[]; keepId: number; suggestedIds: number[] }
export function duplicateGroups(tabs: readonly TabInfo[]): DuplicateGroup[] {
  const groups = new Map<string, TabInfo[]>();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const key = (tab.incognito ? 'private:' : 'normal:') + tab.url;
    const group = groups.get(key) ?? []; group.push(tab); groups.set(key, group);
  }
  return [...groups].filter(([, group]) => group.length > 1).map(([key, tabs]) => {
    const ordered = [...tabs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || Number(!!b.audible) - Number(!!a.audible) || Number(!!b.active) - Number(!!a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const keepId = ordered[0].id;
    return { key, url: tabs[0].url, tabs, keepId, suggestedIds: tabs.filter(tab => tab.id !== keepId && !tab.pinned && !tab.audible).map(tab => tab.id) };
  });
}
export async function closeDuplicateTabs(snapshot: readonly TabInfo[], progress: (done: number) => void) {
  const closed: ClosedTab[] = [], failedIds: number[] = [];
  for (const tab of [...new Map(snapshot.map(tab => [tab.id, tab])).values()]) {
    try {
      const current = await chrome.tabs.get(tab.id);
      closed.push(await closeWithUndo({ ...tab, title: current.title ?? tab.title, windowId: current.windowId, index: current.index }, async () => {
        const live = await chrome.tabs.get(tab.id);
        if (live.url !== tab.url || !!live.incognito !== !!tab.incognito || (live.pinned && !tab.pinned) || (live.audible && !tab.audible)) throw new Error('Page changed');
        const peers = await chrome.tabs.query({});
        if (!peers.some(peer => peer.id !== tab.id && peer.url === tab.url && !!peer.incognito === !!tab.incognito)) throw new Error('Last copy');
      }));
    } catch { failedIds.push(tab.id); }
    progress(closed.length + failedIds.length);
  }
  return { closed, failedIds };
}
