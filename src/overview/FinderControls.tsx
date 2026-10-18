import { useMemo, useState } from 'react';
import { Check, Globe, X } from 'lucide-react';
import type { TabInfo } from '../lib/tabManager';
import type { TabOrder } from '../lib/finderOptions';
import { tabDomain } from '../lib/tabDomain';
import { QuickMenu } from './QuickMenu';

function SiteIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const source = new URL(chrome.runtime.getURL('/_favicon/'));
  source.searchParams.set('pageUrl', url); source.searchParams.set('size', '32');
  return failed ? <Globe size={15} aria-hidden="true" /> : <img className="finder-site-icon" src={source.toString()} alt="" onError={() => setFailed(true)} />;
}
function Options({ kind, options, selected, choose }: { kind: string; options: { id: string; label: string; detail?: string; count: number; url?: string }[]; selected: string; choose: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const matches = options.filter(option => (option.label + ' ' + (option.detail ?? '')).normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase()));
  return <>
    <input type="search" className="finder-menu-search" placeholder={'查找' + kind + '…'} aria-label={'筛选' + kind} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="finder-options" role="group" aria-label={kind + '列表'}>
      {!query && <button type="button" className="finder-option" aria-pressed={!selected} onClick={() => choose('')}><span className="finder-option-copy">全部{kind}</span>{!selected && <Check size={14} aria-hidden="true" />}</button>}
      {matches.map(option => <button key={option.id} type="button" className="finder-option" data-domain={kind === '网站' ? option.id : undefined} aria-pressed={selected === option.id} onClick={() => choose(option.id)}>
        {option.url && <SiteIcon url={option.url} />}<span className="finder-option-copy"><span>{option.label}</span>{option.detail && <small>{option.detail}</small>}</span>
        <span className="finder-count">{option.count}</span>{selected === option.id && <Check size={14} aria-hidden="true" />}
      </button>)}
      {!matches.length && <span className="finder-no-options">没有匹配的{kind}</span>}
    </div>
  </>;
}
interface Props {
  tabs: TabInfo[];
  domains: readonly (readonly [string, number])[];
  numbers: Map<number, number>;
  windowId: number | null;
  domain: string;
  order: TabOrder;
  disabled: boolean;
  searching: boolean;
  onWindow: (id: number | null) => void;
  onDomain: (domain: string) => void;
  onOrder: (order: TabOrder) => void;
  onClear: () => void;
}
export function FinderControls({ tabs, domains, numbers, windowId, domain, order, disabled, searching, onWindow, onDomain, onOrder, onClear }: Props) {
  const windows = useMemo(() => {
    const groups = new Map<number, TabInfo[]>();
    for (const tab of tabs) { const group = groups.get(tab.windowId) ?? []; group.push(tab); groups.set(tab.windowId, group); }
    return [...groups].sort((a, b) => (numbers.get(a[0]) ?? 0) - (numbers.get(b[0]) ?? 0)).map(([id, group]) => ({
      id: String(id), label: '窗口 ' + numbers.get(id), count: group.length, detail: (group.find(tab => tab.active) ?? group[0]).title
    }));
  }, [tabs, numbers]);
  const sites = useMemo(() => {
    const urls = new Map<string, string>();
    for (const tab of tabs) if (!urls.has(tabDomain(tab.url))) urls.set(tabDomain(tab.url), tab.url);
    return domains.map(([name, count]) => ({ id: name, label: name, count, url: urls.get(name) }));
  }, [domains, tabs]);
  return <div className="domain-filters" role="group" aria-label="筛选与排列">
    <span className="finder-filter">
      <QuickMenu name="按窗口筛选" label={windowId === null ? '全部窗口' : '窗口 ' + numbers.get(windowId)} selected={windowId !== null} disabled={disabled}>
        {close => <Options kind="窗口" options={windows} selected={windowId === null ? '' : String(windowId)} choose={value => { onWindow(value ? Number(value) : null); close(); }} />}
      </QuickMenu>
      {windowId !== null && <button className="finder-clear" type="button" disabled={disabled} aria-label={'取消窗口 ' + numbers.get(windowId) + ' 筛选'} onClick={() => onWindow(null)}><X size={12} /></button>}
    </span>
    <span className="finder-filter">
      <QuickMenu name="按网站筛选" label={domain || '全部网站'} selected={!!domain} disabled={disabled}>
        {close => <Options kind="网站" options={sites} selected={domain} choose={value => { onDomain(value); close(); }} />}
      </QuickMenu>
      {domain && <button className="finder-clear" type="button" disabled={disabled} aria-label="取消网站筛选" onClick={() => onDomain('')}><X size={12} /></button>}
    </span>
    <QuickMenu name="排列方式" label={searching ? '相关性' : order === 'recent' ? '最近使用' : '原有顺序'} disabled={disabled || searching}>
      {close => <div role="group" aria-label="排列方式选项">{(['original', 'recent'] as const).map(value => <button key={value} type="button" className="finder-option" aria-pressed={order === value}
        onClick={() => { onOrder(value); close(); }}><span className="finder-option-copy">{value === 'recent' ? '最近使用' : '原有顺序'}</span>{order === value && <Check size={14} aria-hidden="true" />}</button>)}</div>}
    </QuickMenu>
    {(domain || windowId !== null) && <button type="button" className="finder-reset" disabled={disabled} aria-label="清除网站和窗口筛选" onClick={onClear}>清除</button>}
  </div>;
}
