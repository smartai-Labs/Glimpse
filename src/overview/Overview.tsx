import { useEffect, useState, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { Keyboard, ListChecks, PanelsTopLeft } from 'lucide-react';
import { FixedSizeGrid as Grid } from 'react-window';
import type { GridChildComponentProps } from 'react-window';
import Fuse from 'fuse.js';
import { getAllTabs, switchToTab } from '../lib/tabManager';
import type { TabInfo } from '../lib/tabManager';
import { tabDomain } from '../lib/tabDomain';
import { useKeyboardNavigation, parseShortcut } from '../lib/keyboard';
import { TabCard } from './TabCard';
import { SearchBar } from './SearchBar';
import { reconcileTabs, reconcileWindowNumbers, reconcileDomainOrder } from '../lib/overviewOrder';
import { readOverviewPosition, saveOverviewPosition, orderFromPosition, scrollFromPosition } from '../lib/overviewMemory';
import type { OverviewPosition } from '../lib/overviewMemory';
import { createTitleKeywordProvider } from '../lib/titleKeywords';
import { closeWithUndo, restoreClosedTab } from '../lib/undoClose';
import type { ClosedTab } from '../lib/undoClose';
import { closeTabsWithUndo, mergeBrowserWindows } from '../lib/batchActions';

interface ClosedAction { token: string; items: ClosedTab[]; expiresAt: number }

interface CellData {
  tabs: TabInfo[];
  columns: number;
  selectedIndex: number;
  selectionMode: boolean;
  checkedIds: Set<number>;
  disabled: boolean;
  windowNumbers: Map<number, number>;
  select: (index: number) => void;
  close: (index: number) => void;
  highlight: (index: number) => void;
  filterWindow: (windowId: number) => void;
}

function Cell({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CellData>) {
  const index = rowIndex * data.columns + columnIndex, tab = data.tabs[index];
  if (!tab) return null;
  return <TabCard key={tab.id} tab={tab} style={style} isSelected={index === data.selectedIndex}
    selectionMode={data.selectionMode} checked={data.checkedIds.has(tab.id)} disabled={data.disabled}
    windowNumber={data.windowNumbers.get(tab.windowId) ?? 1}
    onFocus={() => data.highlight(index)} onClick={() => data.select(index)}
    onFilterWindow={() => data.filterWindow(tab.windowId)}
    onClose={e => { e.stopPropagation(); data.close(index); }} />;
}

function itemKey({ columnIndex, rowIndex, data }: { columnIndex: number; rowIndex: number; data: CellData }) {
  return data.tabs[rowIndex * data.columns + columnIndex]?.id ?? `empty-${rowIndex}-${columnIndex}`;
}

export function Overview() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [windowFilter, setWindowFilter] = useState<number | null>(null);
  const [windowNumbers, setWindowNumbers] = useState<Map<number, number>>(() => new Map());
  const [domainOrder, setDomainOrder] = useState<string[]>([]);
  const [closedActions, setClosedActions] = useState<ClosedAction[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [undoPaused, setUndoPaused] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [shortcut, setShortcut] = useState('');
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Grid<CellData>>(null);
  const initialScrollDone = useRef(false);
  const switching = useRef(false);
  const closingIds = useRef(new Set<number>());
  const restorePending = useRef(false);
  const operationPending = useRef(false);
  const refreshRevision = useRef(0);
  const savedPosition = useRef<OverviewPosition | null>(null);
  const scrollTopRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keywordProvider = useMemo(() => createTitleKeywordProvider(), []);
  const getKeywords = useCallback(() => keywordProvider(tabs), [keywordProvider, tabs]);

  const flushPosition = useCallback(async () => {
    clearTimeout(saveTimer.current);
    await saveOverviewPosition(savedPosition.current);
  }, []);

  useEffect(() => {
    const flush = () => { void flushPosition(); };
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(saveTimer.current); window.removeEventListener('pagehide', flush); };
  }, [flushPosition]);

  useEffect(() => {
    const element = filtersRef.current;
    if (!element) return;
    const scrollFilters = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const before = element.scrollLeft;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      element.scrollLeft += event.deltaY * unit;
      if (element.scrollLeft !== before) event.preventDefault();
    };
    element.addEventListener('wheel', scrollFilters, { passive: false });
    return () => element.removeEventListener('wheel', scrollFilters);
  }, []);

  useEffect(() => {
    let mounted = true, initialized = false;
    const positionReady = readOverviewPosition();
    const refresh = async () => {
      const current = ++refreshRevision.current;
      try {
        let [next, position] = await Promise.all([getAllTabs(), positionReady]);
        if (mounted && current === refreshRevision.current) {
          if (!initialized) {
            // Only remember ordinary browsing positions, without page titles or URLs.
            if (next.some(tab => tab.incognito)) position = null;
            savedPosition.current = position;
            next = orderFromPosition(next, position);
            if (position) setWindowNumbers(reconcileWindowNumbers(new Map(position.windows), next));
            initialized = true;
          }
          setTabs(previous => reconcileTabs(previous, next));
          setWindowNumbers(previous => reconcileWindowNumbers(previous, next));
          setDomainOrder(previous => reconcileDomainOrder(previous, next));
        }
      } catch {
        if (mounted) setError('无法读取标签页，请重新打开照面 Glimpse。');
      }
    };
    void refresh();
    const events = [chrome.tabs.onMoved, chrome.tabs.onDetached, chrome.tabs.onAttached, chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated];
    events.forEach(event => event.addListener(refresh));
    chrome.commands.getAll().then(commands => {
      if (mounted) setShortcut(commands.find(c => c.name === '_execute_action')?.shortcut ?? '');
    }).catch(() => {});
    return () => { mounted = false; events.forEach(event => event.removeListener(refresh)); };
  }, []);

  useEffect(() => {
    if (!closedActions.length || restoring || undoPaused || busy) return;
    const timer = setTimeout(() => setClosedActions(previous => previous.filter(item => item.expiresAt > Date.now())), Math.max(0, Math.min(...closedActions.map(item => item.expiresAt)) - Date.now()));
    return () => clearTimeout(timer);
  }, [closedActions, restoring, undoPaused, busy]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width), height = Math.floor(entry.contentRect.height);
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const windowTabs = useMemo(() => windowFilter === null ? tabs : tabs.filter(tab => tab.windowId === windowFilter), [tabs, windowFilter]);
  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    windowTabs.forEach(tab => { const key = tabDomain(tab.url); counts.set(key, (counts.get(key) ?? 0) + 1); });
    return domainOrder.filter(name => counts.has(name)).map(name => [name, counts.get(name)!] as const);
  }, [windowTabs, domainOrder]);
  const activeDomain = domains.some(([name]) => name === domain) ? domain : '';
  const fuse = useMemo(() => new Fuse(tabs, { keys: [{ name: 'title', weight: 2 }, { name: 'url', weight: 1 }], threshold: 0.3, ignoreLocation: true,
    getFn: (tab, path) => ((Array.isArray(path) ? path[0] : path) === 'title' ? tab.title : tab.url).normalize('NFKC') }), [tabs]);
  const filteredTabs = useMemo(() => {
    const matches = query.trim() ? fuse.search(query.trim().normalize('NFKC')).map(result => result.item)
      .filter(tab => windowFilter === null || tab.windowId === windowFilter) : windowTabs;
    return activeDomain ? matches.filter(tab => tabDomain(tab.url) === activeDomain) : matches;
  }, [windowTabs, query, fuse, activeDomain, windowFilter]);
  const checkedTabs = useMemo(() => filteredTabs.filter(tab => checkedIds.has(tab.id)), [filteredTabs, checkedIds]);
  const selectAll = useCallback(() => { if (!operationPending.current) setCheckedIds(new Set(filteredTabs.map(tab => tab.id))); }, [filteredTabs]);
  const selectedIndex = useMemo(() => {
    const index = filteredTabs.findIndex(tab => tab.id === selectedId);
    if (index >= 0) return index;
    if (query.trim()) return filteredTabs.length ? 0 : -1;
    const active = filteredTabs.findIndex(tab => tab.active);
    return active >= 0 ? active : filteredTabs.length ? 0 : -1;
  }, [filteredTabs, selectedId, query]);
  const columns = Math.max(1, Math.floor(size.width / 280));
  const columnWidth = size.width / columns;
  const rowHeight = Math.round(Math.max(0, columnWidth - 20) * 0.625) + 70;

  useEffect(() => {
    if (initialScrollDone.current || !gridRef.current || selectedIndex < 0) return;
    if (savedPosition.current && !query.trim() && !activeDomain && windowFilter === null) {
      scrollTopRef.current = scrollFromPosition(savedPosition.current, tabs, columns, rowHeight);
      gridRef.current.scrollTo({ scrollTop: scrollTopRef.current });
      const anchor = tabs.find(tab => tab.id === savedPosition.current?.anchorId) ?? tabs[Math.min(savedPosition.current.anchorIndex, tabs.length - 1)];
      if (anchor) setSelectedId(anchor.id);
    } else gridRef.current.scrollToItem({ rowIndex: Math.floor(selectedIndex / columns), columnIndex: selectedIndex % columns, align: 'smart' });
    initialScrollDone.current = true;
  }, [selectedIndex, columns, rowHeight, size, tabs, query, activeDomain, windowFilter]);

  const rememberPosition = useCallback((scrollTop = scrollTopRef.current) => {
    if (!initialScrollDone.current) return;
    scrollTopRef.current = scrollTop;
    if (tabs.some(tab => tab.incognito)) { savedPosition.current = null; return; }
    if (!tabs.length || query.trim() || activeDomain || windowFilter !== null) return;
    const index = Math.min(Math.floor(scrollTop / rowHeight) * columns, tabs.length - 1);
    savedPosition.current = { savedAt: Date.now(), order: tabs.map(tab => tab.id), windows: [...windowNumbers],
      anchorId: tabs[index].id, anchorIndex: index, rowOffset: scrollTop % rowHeight };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushPosition(); }, 150);
  }, [tabs, query, activeDomain, windowFilter, columns, rowHeight, windowNumbers, flushPosition]);

  useEffect(() => { rememberPosition(); }, [rememberPosition]);

  useEffect(() => {
    const filters = filtersRef.current;
    const active = [...(filters?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find(button => activeDomain ? button.dataset.domain === activeDomain : button.getAttribute('aria-pressed') === 'true');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeDomain, windowFilter]);

  const select = useCallback(async (index: number) => {
    const tab = filteredTabs[index];
    if (!tab || switching.current || operationPending.current || restorePending.current) return;
    if (selectionMode) {
      setCheckedIds(previous => { const next = new Set(previous); if (next.has(tab.id)) next.delete(tab.id); else next.add(tab.id); return next; });
      return;
    }
    switching.current = true;
    try { await Promise.all([switchToTab(tab.id, tab.windowId), flushPosition()]); window.close(); }
    catch { setError('标签页无法切换，可能已被关闭。'); }
    finally { switching.current = false; }
  }, [filteredTabs, flushPosition, selectionMode]);
  const rememberClosed = useCallback((items: ClosedTab[]) => {
    if (!items.length) return;
    const action = { token: crypto.randomUUID(), items, expiresAt: Date.now() + 10000 };
    setClosedActions(previous => [...previous.filter(item => item.expiresAt > Date.now()), action].slice(-10));
    setUndoPaused(!!(undoRef.current?.matches(':hover') || undoRef.current?.contains(document.activeElement)));
    setNotice('');
  }, []);
  const close = useCallback(async (index: number) => {
    const tab = filteredTabs[index];
    if (!tab || closingIds.current.has(tab.id) || operationPending.current || restorePending.current) return;
    closingIds.current.add(tab.id);
    try {
      const closed = await closeWithUndo(tab);
      setError('');
      setTabs(previous => previous.filter(item => item.id !== tab.id));
      rememberClosed([closed]);
      setSelectedId(previous => previous === tab.id || index === selectedIndex ? (filteredTabs[index + 1] ?? filteredTabs[index - 1])?.id ?? null : previous);
    } catch (cause) {
      console.warn('Glimpse could not close tab', tab.id, cause);
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(/context invalidated/i.test(detail) ? '扩展已更新，请关闭本总览并重新打开。' : '浏览器未能关闭该标签页，请稍后重试。');
    }
    finally { closingIds.current.delete(tab.id); }
  }, [filteredTabs, selectedIndex, rememberClosed]);
  const filterWindow = useCallback((windowId: number) => {
    setWindowFilter(windowId); setCheckedIds(new Set()); setSelectedId(null); setKeyboardNavigation(false); gridRef.current?.scrollTo({ scrollTop: 0, scrollLeft: 0 });
  }, []);
  const highlight = useCallback((index: number) => { if (filteredTabs[index]) setSelectedId(filteredTabs[index].id); }, [filteredTabs]);
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);
  const typeToSearch = useCallback((text: string) => {
    setQuery(previous => previous + text); setCheckedIds(new Set()); setSelectedId(null); searchRef.current?.focus(); gridRef.current?.scrollTo({ scrollTop: 0 });
  }, []);
  const closeOverview = useCallback(async () => { if (operationPending.current || restorePending.current) return; await flushPosition(); window.close(); }, [flushPosition]);
  const escape = useCallback(() => {
    if (operationPending.current || restorePending.current) return;
    setKeyboardNavigation(false);
    if (selectionMode) { setSelectionMode(false); setCheckedIds(new Set()); }
    else if (query) { setQuery(''); setSelectedId(null); scrollTopRef.current = 0; gridRef.current?.scrollTo({ scrollTop: 0 }); }
    else if (domain || windowFilter !== null) { setDomain(''); setWindowFilter(null); setSelectedId(null); scrollTopRef.current = 0; gridRef.current?.scrollTo({ scrollTop: 0 }); }
    else void closeOverview();
  }, [query, domain, windowFilter, closeOverview, selectionMode]);
  const closeShortcut = useMemo(() => shortcut ? parseShortcut(shortcut) : null, [shortcut]);
  useKeyboardNavigation({ totalItems: filteredTabs.length, columns, selectedIndex, onSelect: select, onCloseTab: close,
    selectionMode, onSelectAll: selectAll,
    onFocusSearch: focusSearch, onTypeSearch: typeToSearch, onCloseOverview: closeOverview, onEscape: escape, closeShortcut,
    onIndexChange: index => {
      highlight(index); setKeyboardNavigation(true); (document.activeElement as HTMLElement | null)?.blur();
      gridRef.current?.scrollToItem({ rowIndex: Math.floor(index / columns), columnIndex: index % columns, align: 'smart' });
    } });
  const itemData = useMemo<CellData>(() => ({ tabs: filteredTabs, columns, selectedIndex, selectionMode, checkedIds, disabled: !!busy || restoring, windowNumbers, select, close, highlight, filterWindow }), [filteredTabs, columns, selectedIndex, selectionMode, checkedIds, busy, restoring, windowNumbers, select, close, highlight, filterWindow]);

  async function refreshAfterAction() {
    const current = ++refreshRevision.current;
    const next = await getAllTabs();
    if (current === refreshRevision.current) {
      setTabs(previous => reconcileTabs(previous, next));
      setWindowNumbers(previous => reconcileWindowNumbers(previous, next));
      setDomainOrder(previous => reconcileDomainOrder(previous, next));
    }
  }

  async function closeChecked() {
    if (!checkedTabs.length || operationPending.current || restorePending.current || closingIds.current.size) return;
    operationPending.current = true; setError(''); setBusy(`正在关闭 0/${checkedTabs.length}`);
    const snapshot = [...checkedTabs];
    try {
      const result = await closeTabsWithUndo(snapshot, done => setBusy(`正在关闭 ${done}/${snapshot.length}`));
      rememberClosed(result.closed);
      const removed = new Set(result.closed.map(item => item.tab.id));
      setTabs(previous => previous.filter(tab => !removed.has(tab.id)));
      setCheckedIds(new Set(result.failedIds));
      if (result.failedIds.length) setError(`已关闭 ${result.closed.length} 个标签，${result.failedIds.length} 个未能关闭，可重试。`);
      // Keep the toolbar in place so a second click cannot hit Merge Windows.
    } catch { setError('批量关闭未完成，请重试。'); }
    finally { operationPending.current = false; setBusy(''); }
  }

  async function mergeWindows() {
    if (operationPending.current || restorePending.current || closingIds.current.size) return;
    operationPending.current = true; setError(''); setNotice(''); setBusy('正在合并窗口…');
    const overviewWindow = await chrome.windows.getCurrent().catch(() => null);
    try {
      const result = await mergeBrowserWindows((done, total) => setBusy(`正在合并 ${done}/${total}`));
      setWindowFilter(null); setCheckedIds(new Set());
      setNotice(result.moved ? `已合并 ${result.moved} 个标签${result.separatePrivate ? '，普通与隐身窗口分别保留' : ''}` : result.failed ? '' : '没有需要合并的标签');
      if (result.failed) setError(`${result.failed} 个标签未能合并，请检查后重试。`);
      await refreshAfterAction();
    } catch { setError('窗口合并未完成，请重试。'); }
    finally {
      if (overviewWindow?.id !== undefined) await chrome.windows.update(overviewWindow.id, { focused: true }).catch(() => {});
      operationPending.current = false; setBusy('');
    }
  }

  async function undoClose() {
    const action = closedActions.at(-1);
    if (!action || restorePending.current || operationPending.current || closingIds.current.size) return;
    restorePending.current = true; setRestoring(true);
    const failed: ClosedTab[] = [];
    const restoredWindows = new Map<number, number>();
    let recreated = false, restoredCount = 0;
    const overviewWindow = await chrome.windows.getCurrent().catch(() => null);
    try {
      for (const closed of action.items) {
        try {
          const mappedWindow = restoredWindows.get(closed.tab.windowId);
          const restored = await restoreClosedTab(mappedWindow !== undefined && !closed.sessionId ? { ...closed, tab: { ...closed.tab, windowId: mappedWindow } } : closed);
          recreated ||= restored.recreated; restoredCount++;
          if (restored.tab?.id !== undefined) {
            restoredWindows.set(closed.tab.windowId, restored.tab.windowId);
            setSelectedId(restored.tab.id);
            if (windowFilter === closed.tab.windowId && restored.tab.windowId !== windowFilter) setWindowFilter(restored.tab.windowId);
          }
        } catch (cause) {
          failed.push(closed);
          setError(cause instanceof Error ? cause.message : '暂时无法恢复标签页，请重试。');
        }
      }
      setClosedActions(previous => previous.flatMap(item => item.token !== action.token ? [item] : failed.length ? [{ ...item, items: failed, expiresAt: Date.now() + 10000 }] : []));
      if (!failed.length) setError('');
      else if (action.items.length > 1) setError(`已恢复 ${restoredCount} 个标签，${failed.length} 个未恢复，可重试。`);
      await refreshAfterAction();
      setNotice(recreated ? '已重新打开原网址；未恢复页面历史或未提交内容。' : `已恢复 ${restoredCount} 个标签`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法恢复标签页，请重试。'); }
    finally {
      if (overviewWindow?.id !== undefined) await chrome.windows.update(overviewWindow.id, { focused: true }).catch(() => {});
      restorePending.current = false; setRestoring(false);
    }
  }

  function resumeUndoTimer() {
    setClosedActions(previous => previous.map(item => ({ ...item, expiresAt: Math.max(item.expiresAt, Date.now() + 5000) })));
    setUndoPaused(false);
  }

  function resetPosition() { setSelectedId(null); setCheckedIds(new Set()); setKeyboardNavigation(false); scrollTopRef.current = 0; gridRef.current?.scrollTo({ scrollTop: 0, scrollLeft: 0 }); }
  async function openShortcutSettings() {
    try {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts', windowId: windows.at(-1)?.id });
      window.close();
    } catch { setError('无法打开快捷键设置。'); }
  }

  return <main className="glimpse-overview" data-keyboard-navigation={keyboardNavigation}
    onPointerMove={keyboardNavigation ? () => setKeyboardNavigation(false) : undefined}
    onPointerDown={keyboardNavigation ? () => setKeyboardNavigation(false) : undefined}
    onFocusCapture={keyboardNavigation ? () => setKeyboardNavigation(false) : undefined}>
    <header className="overview-header">
      <SearchBar query={query} onQueryChange={value => { setQuery(value); resetPosition(); }} inputRef={searchRef}
        getKeywords={getKeywords} onKeywordSelect={term => { setDomain(''); setWindowFilter(null); setQuery(term); resetPosition(); }} />
      <div className="overview-summary">
        <span className="tab-count" aria-live="polite">{filteredTabs.length} 个标签</span>
        <button type="button" className="shortcut-settings" disabled={!!busy || restoring} aria-label="设置照面 Glimpse 快捷键" title={shortcut ? `设置快捷键（${shortcut}）` : '设置快捷键'} onClick={openShortcutSettings}><Keyboard size={17} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="overview-toolbar" aria-busy={!!busy}>
      <div ref={filtersRef} className="domain-filters" aria-label="按网站筛选">
        <button type="button" aria-pressed={!activeDomain && windowFilter === null} onClick={() => { setDomain(''); setWindowFilter(null); resetPosition(); }}>全部 <span>{tabs.length}</span></button>
        {windowFilter !== null && <button type="button" className="active-window-filter" aria-label={`取消窗口 ${windowNumbers.get(windowFilter)} 筛选`} aria-pressed="true" onClick={() => { setWindowFilter(null); resetPosition(); }}>窗口 {windowNumbers.get(windowFilter)} <span aria-hidden="true">×</span></button>}
        {domains.map(([name, count]) => <button key={name} data-domain={name} type="button" aria-pressed={activeDomain === name} onClick={() => { setDomain(name); resetPosition(); }}>{name} <span>{count}</span></button>)}
      </div>
      <div className="overview-actions" role="group" aria-label="批量操作">
        {selectionMode ? <>
          <span className="selection-count" aria-live="polite">已选 {checkedTabs.length}</span>
          <button type="button" disabled={!!busy || restoring || !filteredTabs.length} onClick={() => checkedTabs.length === filteredTabs.length ? setCheckedIds(new Set()) : selectAll()}>{checkedTabs.length === filteredTabs.length && filteredTabs.length ? '取消全选' : '全选结果'}</button>
          <button type="button" className="batch-close" disabled={!!busy || restoring || !checkedTabs.length} onClick={closeChecked}>关闭所选</button>
          <button type="button" disabled={!!busy || restoring} onClick={() => { setSelectionMode(false); setCheckedIds(new Set()); }}>取消</button>
        </> : <>
          <button type="button" disabled={!!busy || restoring || !tabs.length} onClick={() => setSelectionMode(true)}><ListChecks size={15} aria-hidden="true" />多选</button>
          <button type="button" disabled={!!busy || restoring || !tabs.length} title="将所有页面合并到最近使用的浏览器窗口，普通和隐身窗口分别处理" onClick={mergeWindows}><PanelsTopLeft size={15} aria-hidden="true" />合并窗口</button>
        </>}
      </div>
    </div>
    {error && <div className="overview-error" role="alert">{error}<button type="button" aria-label="关闭提示" onClick={() => setError('')}>×</button></div>}
    <div className="overview-grid-container" ref={viewportRef}>
      {size.width > 0 && size.height > 0 && filteredTabs.length > 0 && <Grid<CellData> ref={gridRef} className="tab-viewport"
        columnCount={columns} columnWidth={columnWidth} rowCount={Math.ceil(filteredTabs.length / columns)} rowHeight={rowHeight}
        width={size.width} height={size.height} itemData={itemData} itemKey={itemKey} overscanRowCount={2}
        onScroll={({ scrollTop }) => rememberPosition(scrollTop)}>{Cell}</Grid>}
      {filteredTabs.length === 0 && <div className="overview-empty">没有找到标签页{(query || activeDomain || windowFilter !== null) && <button type="button" onClick={() => { setQuery(''); setDomain(''); setWindowFilter(null); resetPosition(); }}>清除筛选</button>}</div>}
    </div>
    <footer className="overview-footer">
      {busy && <div className="batch-progress" role="status">{busy}</div>}
      <div ref={undoRef} className="undo-notice" role="status" aria-live="polite"
        onPointerEnter={() => setUndoPaused(true)} onPointerLeave={e => { if (!e.currentTarget.contains(document.activeElement)) resumeUndoTimer(); }}
        onFocus={() => setUndoPaused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget) && !e.currentTarget.matches(':hover')) resumeUndoTimer(); }}>
        {closedActions.length ? <><span className="undo-title">{closedActions.at(-1)!.items.length > 1 ? `已关闭 ${closedActions.at(-1)!.items.length} 个标签` : `已关闭：${closedActions.at(-1)!.items[0].tab.title}`}</span><button type="button" onClick={undoClose} disabled={restoring || !!busy}>{restoring ? '恢复中…' : closedActions.at(-1)!.items.length > 1 ? '撤销本次' : '撤销'}{closedActions.length > 1 && `（${closedActions.length}）`}</button></> : notice ? <span>{notice}</span> : null}
      </div>
    </footer>
  </main>;
}
