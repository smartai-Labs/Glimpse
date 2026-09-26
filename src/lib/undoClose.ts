import type { TabInfo } from './tabManager';

export interface ClosedTab {
  token: string;
  tab: TabInfo;
  sessionId?: string;
  expiresAt: number;
}

function sessionId(session: chrome.sessions.Session): string | undefined {
  return session.tab?.sessionId ?? session.window?.sessionId;
}

function matchingSession(sessions: chrome.sessions.Session[], before: Set<string | undefined>, tab: TabInfo): string | undefined {
  const matches = sessions.filter(session => {
    if (!sessionId(session) || before.has(sessionId(session))) return false;
    // Never restore a multi-tab window as an undo for one card.
    const candidate = session.tab ?? (session.window?.tabs?.length === 1 ? session.window.tabs[0] : undefined);
    if (!candidate || candidate.url !== tab.url || candidate.title !== tab.title) return false;
    if (candidate.id !== undefined && candidate.id >= 0 && candidate.id !== tab.id) return false;
    if (candidate.windowId !== undefined && candidate.windowId >= 0 && candidate.windowId !== tab.windowId) return false;
    return true;
  });
  return matches.length === 1 ? sessionId(matches[0]) : undefined;
}

let closeQueue: Promise<unknown> = Promise.resolve();

async function readClosedSessions(): Promise<chrome.sessions.Session[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Upgraded/older extension pages may not expose this optional capability yet.
    // Catch both synchronous API errors and rejected promises, and bound the wait.
    if (typeof chrome.sessions?.getRecentlyClosed !== 'function') return null;
    const result = await Promise.race([
      Promise.resolve().then(() => chrome.sessions.getRecentlyClosed()),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 600); })
    ]);
    return Array.isArray(result) ? result : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function closeWithUndo(tab: TabInfo): Promise<ClosedTab> {
  // Serialize our close operations so same-URL tabs don't claim each other's session.
  const operation = closeQueue.then(async () => {
    const token = crypto.randomUUID();
    const recent = tab.incognito ? null : await readClosedSessions();
    const before = recent === null ? null : new Set(recent.map(sessionId));
    await chrome.tabs.remove(tab.id);
    let restoredSession: string | undefined;
    try {
      if (before !== null) {
        // Recently-closed records can arrive slightly after tabs.remove resolves.
        for (const delay of [0, 100, 250]) {
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          const after = await readClosedSessions();
          if (after === null) break;
          restoredSession = matchingSession(after, before, tab);
          if (restoredSession) break;
        }
      }
    } catch { /* Undo metadata must never turn a successful close into an error. */ }
    return { token, tab, sessionId: restoredSession, expiresAt: Date.now() + 10000 };
  });
  closeQueue = operation.catch(() => {});
  return operation;
}

export async function restoreClosedTab(closed: ClosedTab): Promise<{ tab?: chrome.tabs.Tab; recreated: boolean }> {
  if (closed.sessionId) {
    // Check the exact record is still present. Never use restore() without an ID.
    const sessions = await readClosedSessions();
    if (sessions === null || typeof chrome.sessions?.restore !== 'function') throw new Error('暂时无法读取恢复记录，请重新加载扩展后重试。');
    if (sessions.some(session => sessionId(session) === closed.sessionId)) {
      const restored = await chrome.sessions.restore(closed.sessionId);
      return { tab: restored.tab ?? restored.window?.tabs?.[0], recreated: false };
    }
  }
  // Chrome may omit new-tab/private sessions or the user may already have consumed it.
  // If a known session disappeared, don't create an accidental duplicate.
  if (closed.sessionId) throw new Error('该标签已被恢复，或恢复记录已过期。');
  if (!/^(https?|file|chrome|edge):\/\//i.test(closed.tab.url)) throw new Error('此页面无法自动重新打开。');
  const window = await chrome.windows.get(closed.tab.windowId).catch(() => null);
  if (window && window.type === 'normal' && !!window.incognito === !!closed.tab.incognito) {
    const siblings = await chrome.tabs.query({ windowId: window.id });
    const tab = await chrome.tabs.create({ windowId: window.id, url: closed.tab.url, index: Math.min(closed.tab.index, siblings.length), active: false });
    return { tab, recreated: true };
  }
  const created = await chrome.windows.create({ url: closed.tab.url, incognito: !!closed.tab.incognito, focused: false, type: 'normal' });
  return { tab: created?.tabs?.[0], recreated: true };
}
