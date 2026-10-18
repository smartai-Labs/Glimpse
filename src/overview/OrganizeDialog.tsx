import { useEffect, useMemo, useRef, useState } from 'react';
import type { TabInfo } from '../lib/tabManager';
import { getBrowserWindows, moveTabs, partialGroupCount, duplicateGroups, closeDuplicateTabs } from '../lib/organizeTabs';
import type { BrowserWindow, MovePlan } from '../lib/organizeTabs';
import type { ClosedTab } from '../lib/undoClose';
import { ToolDialog } from './ToolDialog';

interface Props { tabs: TabInfo[]; numbers: Map<number, number>; onClose: () => void; onChanged: () => Promise<void>; onNotice: (message: string) => void }
function windowLabel(window: BrowserWindow, numbers: Map<number, number>) {
  return '窗口 ' + (numbers.get(window.id) ?? window.id) + ' · ' + window.tabs.length + ' 个页面' + (window.incognito ? ' · 隐身' : '');
}
export function MoveDialog({ tabs, selected, numbers, mode, onClose, onChanged, onNotice }: Props & { selected: TabInfo[]; mode: 'move' | 'merge' }) {
  const [windows, setWindows] = useState<BrowserWindow[] | null>(null), [targets, setTargets] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Set<number>>(() => new Set());
  const [message, setMessage] = useState(''), [busy, setBusy] = useState('');
  const pending = useRef(false), [remaining, setRemaining] = useState<Set<number> | null>(null);
  useEffect(() => {
    let mounted = true;
    void getBrowserWindows(tabs).then(next => {
      if (!mounted) return;
      setWindows(next); setSources(new Set(next.map(window => window.id)));
      setTargets({ normal: mode === 'move' ? 'new' : String(next.find(window => !window.incognito)?.id ?? ''), private: mode === 'move' ? 'new' : String(next.find(window => window.incognito)?.id ?? '') });
    }).catch(() => { if (mounted) setMessage('无法读取窗口，请关闭面板后重试。'); });
    return () => { mounted = false; };
  }, [tabs, mode]);
  const candidates = mode === 'move' ? selected : (windows ?? []).flatMap(window => sources.has(window.id) ? window.tabs : []);
  const plans: MovePlan[] = candidates.filter(tab => (!remaining || remaining.has(tab.id)) && targets[tab.incognito ? 'private' : 'normal'] && String(tab.windowId) !== targets[tab.incognito ? 'private' : 'normal'])
    .map(tab => ({ tab, target: targets[tab.incognito ? 'private' : 'normal'] === 'new' ? 'new' : Number(targets[tab.incognito ? 'private' : 'normal']) }));
  const partial = partialGroupCount(plans.map(plan => plan.tab), tabs);
  async function execute() {
    if (pending.current || !plans.length) return;
    pending.current = true; setBusy('正在移动…'); setMessage('');
    const overview = await chrome.windows.getCurrent().catch(() => null);
    try {
      const result = await moveTabs(plans, (done, total) => setBusy('正在移动 ' + done + '/' + total));
      const report = '已移动 ' + result.moved + ' 个页面' + (result.skipped ? '，' + result.skipped + ' 个已关闭或已在目标窗口' : '');
      await onChanged();
      if (result.failedIds.length) { setRemaining(new Set(result.failedIds)); setMessage(report + '，' + result.failedIds.length + ' 个未完成。检查窗口后可重试。'); }
      else { onNotice(report); onClose(); }
    } catch { setMessage('移动未完成，请检查窗口后重试。'); }
    finally { if (overview?.id !== undefined) await chrome.windows.update(overview.id, { focused: true }).catch(() => {}); pending.current = false; setBusy(''); }
  }
  return <ToolDialog title={mode === 'move' ? '移动所选页面' : '合并窗口'} busy={!!busy} onClose={onClose}
    footer={<><span className="tool-subtle">{busy || plans.length + ' 个页面将移动'}</span><button type="button" className="tool-button primary" disabled={!!busy || !plans.length} onClick={execute}>{remaining ? '重试未完成项' : mode === 'move' ? '移动页面' : '合并所选窗口'}</button></>}>
    {!windows && !message && <p className="tool-subtle">正在读取窗口…</p>}
    {[false, true].filter(privacy => (mode === 'move' ? selected : tabs).some(tab => !!tab.incognito === privacy)).map(privacy => {
      const key = privacy ? 'private' : 'normal', peers = (windows ?? []).filter(window => window.incognito === privacy);
      return <section className="tool-section" key={key}>
        <h3>{privacy ? '隐身窗口' : '普通窗口'}</h3>
        <label className="tool-field">移入窗口<select aria-label={privacy ? '隐身页面目标窗口' : '目标窗口'} disabled={!!busy || !windows} value={targets[key] ?? ''}
          onChange={event => { setTargets(previous => ({ ...previous, [key]: event.target.value })); setRemaining(null); }}>
          <option value="new">新建窗口</option>{peers.map(window => <option key={window.id} value={window.id}>{windowLabel(window, numbers)} · {(window.tabs.find(tab => tab.active) ?? window.tabs[0])?.title ?? '空窗口'}</option>)}
        </select></label>
        {mode === 'merge' && <div className="tool-window-list" role="group" aria-label={privacy ? '隐身来源窗口' : '来源窗口'}>{peers.filter(window => String(window.id) !== targets[key]).map(window =>
          <label className="tool-check-row" key={window.id}><input type="checkbox" disabled={!!busy} checked={sources.has(window.id)} onChange={event => { setSources(previous => { const next = new Set(previous); if (event.target.checked) next.add(window.id); else next.delete(window.id); return next; }); setRemaining(null); }} />
            <span><span>{windowLabel(window, numbers)}</span><small>{(window.tabs.find(tab => tab.active) ?? window.tabs[0])?.title}</small></span></label>)}</div>}
      </section>;
    })}
    {partial > 0 && <p className="tool-note">包含 {partial} 个未完整选中的标签组：只有选中的页面会移动，并离开原组。</p>}
    {mode === 'merge' && <p className="tool-subtle">按上方窗口范围合并，普通与隐身页面分别处理。</p>}
    {message && <p className="tool-message" role="alert">{message}</p>}
  </ToolDialog>;
}

export function DuplicatesDialog({ tabs, numbers, onClose, onChanged, onNotice, onClosed }: Props & { onClosed: (items: ClosedTab[]) => void }) {
  const initial = useMemo(() => duplicateGroups(tabs), [tabs]);
  const [closedIds, setClosedIds] = useState<Set<number>>(() => new Set());
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(initial.flatMap(group => group.suggestedIds)));
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''); const pending = useRef(false);
  const groups = duplicateGroups(tabs.filter(tab => !closedIds.has(tab.id)));
  const candidates = groups.flatMap(group => group.tabs.filter(tab => chosen.has(tab.id)));
  async function closeChosen() {
    if (pending.current || !candidates.length) return;
    pending.current = true; setBusy('正在关闭…'); setMessage('');
    try {
      const result = await closeDuplicateTabs(candidates, done => setBusy('正在关闭 ' + done + '/' + candidates.length));
      onClosed(result.closed); setClosedIds(previous => new Set([...previous, ...result.closed.map(item => item.tab.id)]));
      setChosen(new Set(result.failedIds)); await onChanged();
      const report = '已关闭 ' + result.closed.length + ' 个重复页面';
      if (result.failedIds.length) setMessage(report + '，' + result.failedIds.length + ' 个已变化或未能关闭，已保留。');
      else { onNotice(report); onClose(); }
    } catch { setMessage('整理未完成，请重试。'); }
    finally { pending.current = false; setBusy(''); }
  }
  return <ToolDialog title="检查重复页面" onClose={onClose} busy={!!busy}
    footer={<><span className="tool-subtle">{busy || '已选 ' + candidates.length + ' 个副本'}</span><button type="button" className="tool-button danger" disabled={!!busy || !candidates.length} onClick={closeChosen}>关闭所选副本</button></>}>
    <p className="tool-subtle">按完整网址检查，保留参数和页面锚点。每组至少保留一个页面。同网址可能有不同的填写内容，请检查后关闭。</p>
    {!groups.length && <p className="tool-empty">没有重复页面</p>}
    {groups.map(group => <section className="duplicate-group" key={group.key}>
      <h3 title={group.url}>{group.url}</h3>{group.tabs.map(tab => <label className="tool-check-row" key={tab.id}>
        <input type="checkbox" aria-label={'关闭副本：' + tab.title} disabled={!!busy} checked={chosen.has(tab.id)} onChange={event => setChosen(previous => { const next = new Set(previous); if (event.target.checked) next.add(tab.id); else next.delete(tab.id); return next; })} />
        <span><span>{tab.title}</span><small>窗口 {numbers.get(tab.windowId) ?? tab.windowId}{tab.incognito ? ' · 隐身' : ''}{tab.pinned ? ' · 已固定' : ''}{tab.audible ? ' · 正在发声' : ''}{tab.id === group.keepId ? ' · 建议保留' : ''}</small></span>
      </label>)}
    </section>)}
    {message && <p className="tool-message" role="alert">{message}</p>}
  </ToolDialog>;
}
