import type { TabInfo } from './tabManager';
import { closeWithUndo } from './undoClose';
import type { ClosedTab } from './undoClose';

export async function closeTabsWithUndo(tabs: readonly TabInfo[], onProgress: (done: number) => void) {
  const closed: ClosedTab[] = [], failedIds: number[] = [];
  const unique = [...new Map(tabs.map(tab => [tab.id, tab])).values()];
  for (const tab of unique) {
    try {
      // Use the current URL and window if a selected tab navigated before closing.
      const live = await chrome.tabs.get(tab.id);
      closed.push(await closeWithUndo({ ...tab, title: live.title ?? tab.title, url: live.url ?? tab.url,
        windowId: live.windowId, index: live.index, incognito: live.incognito }));
    } catch { failedIds.push(tab.id); }
    onProgress(closed.length + failedIds.length);
  }
  return { closed, failedIds };
}

/** Move live tabs, keeping whole groups and pinned tabs intact. Never recreate pages. */
export async function mergeBrowserWindows(onProgress: (done: number, total: number) => void) {
  const [windows, last] = await Promise.all([
    chrome.windows.getAll({ windowTypes: ['normal'], populate: true }),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null)
  ]);
  const extensionUrl = chrome.runtime.getURL('');
  const ordinary = windows.filter(window => window.type === 'normal' && window.id !== undefined);
  const plans: { tab: chrome.tabs.Tab & { id: number }; target: number }[] = [];
  const destinations = new Set<number>();
  for (const incognito of [false, true]) {
    const peers = ordinary.filter(window => !!window.incognito === incognito);
    const target = peers.find(window => window.id === last?.id) ?? peers[0];
    if (target?.id === undefined) continue;
    destinations.add(target.id);
    for (const source of peers) {
      if (source.id === target.id) continue;
      for (const tab of [...(source.tabs ?? [])].sort((a, b) => a.index - b.index)) {
        if (tab.id === undefined || (tab.url ?? tab.pendingUrl ?? '').startsWith(extensionUrl)) continue;
        plans.push({ tab: tab as chrome.tabs.Tab & { id: number }, target: target.id });
      }
    }
  }
  const attempted = new Set<number>(), accepted = new Set<number>();
  for (const plan of plans) {
    if (attempted.has(plan.tab.id)) continue;
    let unit = [plan];
    try {
      const live = await chrome.tabs.get(plan.tab.id);
      // Don't move a tab the user moved elsewhere while this operation was running.
      if (live.windowId !== plan.tab.windowId) { attempted.add(plan.tab.id); continue; }
      const destination = await chrome.windows.get(plan.target);
      if (destination.type !== 'normal' || !!destination.incognito !== !!live.incognito) throw new Error('Window changed');
      if (live.groupId !== undefined && live.groupId >= 0) {
        const group = await chrome.tabs.query({ groupId: live.groupId });
        const plannedIds = new Set(plans.filter(item => item.target === plan.target).map(item => item.tab.id));
        // A changed group must not sweep in unplanned or extension pages.
        if (group.some(tab => tab.id === undefined || !plannedIds.has(tab.id))) throw new Error('Group changed');
        const groupIds = new Set(group.map(tab => tab.id));
        unit = plans.filter(item => groupIds.has(item.tab.id));
        if (typeof chrome.tabGroups?.move !== 'function') throw new Error('Tab group access unavailable');
        await chrome.tabGroups.move(live.groupId, { windowId: plan.target, index: -1 });
      } else {
        const index = live.pinned ? (await chrome.tabs.query({ windowId: plan.target, pinned: true })).length : -1;
        await chrome.tabs.move(plan.tab.id, { windowId: plan.target, index });
      }
      unit.forEach(item => accepted.add(item.tab.id));
    } catch { /* Keep failed tabs in their original window and continue with the others. */ }
    unit.forEach(item => attempted.add(item.tab.id));
    onProgress(attempted.size, plans.length);
  }
  // Confirm browser state: a resolved move is not proof a pinned tab actually moved.
  const live = await chrome.tabs.query({});
  const byId = new Map(live.map(tab => [tab.id, tab]));
  const moved = plans.filter(plan => accepted.has(plan.tab.id) && byId.get(plan.tab.id)?.windowId === plan.target).length;
  const skipped = plans.filter(plan => !byId.has(plan.tab.id)).length;
  return { moved, failed: plans.length - moved - skipped, skipped, separatePrivate: destinations.size > 1 };
}
