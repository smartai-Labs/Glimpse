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
