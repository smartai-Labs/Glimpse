import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { X, Globe, Check, ImageOff } from 'lucide-react';
import type { TabInfo } from '../lib/tabManager';
import { canCaptureUrl, getThumbnail } from '../lib/thumbnailCache';
import type { Thumbnail } from '../lib/thumbnailCache';
import { tabDomain } from '../lib/tabDomain';

const hoverControllers = new WeakMap<Element, () => void>();

function fixedHitAt(x: number, y: number): HTMLButtonElement | undefined {
  // Look through the enlarged visual to the original grid hit area underneath.
  return document.elementsFromPoint(x, y).find(element => element.matches('.tab-hit')) as HTMLButtonElement | undefined;
}

function aimsAtButton(from: { x: number; y: number }, x: number, y: number, button: Element): boolean {
  const rect = button.getBoundingClientRect();
  let near = 1, far = Infinity;
  // Continue the pointer's path toward the visible button, with a small aiming margin.
  for (const [origin, direction, min, max] of [[from.x, x - from.x, rect.left - 6, rect.right + 6], [from.y, y - from.y, rect.top - 6, rect.bottom + 6]]) {
    if (direction === 0) { if (origin < min || origin > max) return false; }
    else {
      const a = (min - origin) / direction, b = (max - origin) / direction;
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      if (near > far) return false;
    }
  }
  return far !== Infinity && near <= far;
}

interface TabCardProps {
  tab: TabInfo;
  isSelected: boolean;
  selectionMode: boolean;
  checked: boolean;
  disabled: boolean;
  windowNumber: number;
  style: CSSProperties;
  onClick: (e: MouseEvent) => void;
  onClose: (e: MouseEvent) => void;
  onFocus: () => void;
  onFilterWindow: () => void;
}

function Favicon({ tab }: { tab: TabInfo }) {
  const [attempt, setAttempt] = useState(0);
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', tab.url);
  url.searchParams.set('size', '32');
  const src = attempt === 0 ? url.toString() : attempt === 1 ? tab.favIconUrl : '';
  return src
    ? <img src={src} alt="" onError={() => setAttempt(n => n + 1)} />
    : <Globe size={16} aria-hidden="true" />;
}

export const TabCard = memo(function TabCard({ tab, isSelected, selectionMode, checked, disabled, windowNumber, style, onClick, onClose, onFocus, onFilterWindow }: TabCardProps) {
  const cellRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLButtonElement>(null);
  const pointerAnchor = useRef<{ x: number; y: number } | null>(null);
  const [thumbnail, setThumbnail] = useState<{ url: string; image: Thumbnail | null } | null>(null);
  const image = thumbnail?.url === tab.url && !tab.incognito ? thumbnail.image : null;
  const thumbnailUrl = image?.dataUrl;

  useEffect(() => {
    let mounted = true, revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const image = tab.incognito ? null : await getThumbnail(tab.id, tab.url);
        if (mounted && current === revision) setThumbnail({ url: tab.url, image });
      } catch { if (mounted && current === revision) setThumbnail({ url: tab.url, image: null }); }
    };
    const updated = (message: { type?: string; tabId?: number; url?: string }) => {
      if (message?.type === 'mosaic:thumbnail-updated' && message.tabId === tab.id && message.url === tab.url) void load();
    };
    chrome.runtime.onMessage.addListener(updated);
    void load();
    return () => { mounted = false; chrome.runtime.onMessage.removeListener(updated); };
  }, [tab.url, tab.id, tab.incognito]);

  function collapse() {
    pointerAnchor.current = null;
    const cell = cellRef.current;
    if (!cell) return;
    cell.dataset.expanded = 'false';
    cell.style.zIndex = matchMedia('(prefers-reduced-motion: reduce)').matches ? '0' : '1';
  }

  function expand() {
    const cell = cellRef.current, hit = hitRef.current;
    const viewport = cell?.closest('.tab-viewport');
    if (!cell || !hit || !viewport || cell.dataset.expanded === 'true') return;
    // Measure zoom geometry only on entry; all content shares one transform.
    const box = hit.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
    const scale = Math.max(1, Math.min(1.38, 490 / box.width, (bounds.width - 16) / box.width, (bounds.height - 16) / box.height));
    const extra = scale - 1;
    const left = Math.max(bounds.left + 8, Math.min(box.left - box.width * extra / 2, bounds.right - 8 - box.width * scale));
    const top = Math.max(bounds.top + 8, Math.min(box.top - box.height * extra / 2, bounds.bottom - 8 - box.height * scale));
    cell.style.setProperty('--tab-zoom', String(scale));
    cell.style.setProperty('--tab-origin', extra > 0 ? `${(box.left - left) / extra}px ${(box.top - top) / extra}px` : 'center');
    cell.style.zIndex = '2';
    cell.dataset.expanded = 'true';
  }

  useLayoutEffect(() => {
    const cell = cellRef.current;
    if (!cell) return;
    hoverControllers.set(cell, expand);
    return () => { hoverControllers.delete(cell); };
  }, []);

  useLayoutEffect(() => {
    const cell = cellRef.current;
    if (cell) { cell.dataset.expanded = 'false'; cell.style.zIndex = '0'; }
  }, [style.left, style.top, style.width, style.height]);

  useEffect(() => {
    const cell = cellRef.current, viewport = cell?.closest('.tab-viewport');
    const reset = () => { if (cell) { cell.dataset.expanded = 'false'; cell.style.zIndex = '0'; } };
    viewport?.addEventListener('scroll', reset, { passive: true });
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    return () => {
      viewport?.removeEventListener('scroll', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
    };
  }, []);

  return <div ref={cellRef} style={style} className={`tab-cell${isSelected ? ' is-selected' : ''}`} data-tab-id={tab.id} data-checked={selectionMode && checked}
    onPointerMove={e => {
      if (e.pointerType === 'touch') return;
      // Buttons own their visible position; the rest of the preview uses fixed grid cells.
      const action = (e.target as Element).closest('.tab-close, .tab-window-filter, .tab-check');
      // Directly approaching a button must not move it away before pointerdown.
      if (action) return;
      const next = fixedHitAt(e.clientX, e.clientY)?.closest('.tab-cell');
      if (next === e.currentTarget) {
        pointerAnchor.current = { x: e.clientX, y: e.clientY };
        expand();
      } else {
        // Let users reach moved controls across the old cell boundary without a delay.
        // A sideways sweep through the previews still switches cells immediately.
        if (e.currentTarget.dataset.expanded === 'true' && pointerAnchor.current &&
          [...e.currentTarget.querySelectorAll('.tab-close, .tab-window-filter, .tab-check')].some(button => aimsAtButton(pointerAnchor.current!, e.clientX, e.clientY, button))) return;
        pointerAnchor.current = null;
        collapse(); if (next) hoverControllers.get(next)?.();
      }
    }} onPointerLeave={collapse}
    onFocus={e => { onFocus(); if (e.target.matches(':focus-visible')) expand(); }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) collapse(); }}
    onTransitionEnd={e => {
      if (e.propertyName === 'transform' && e.currentTarget.dataset.expanded !== 'true') e.currentTarget.style.zIndex = '0';
    }}>
    <div className="tab-slot">
      <button ref={hitRef} type="button" className="tab-hit" disabled={disabled}
        aria-label={selectionMode ? `选择标签页：${tab.title}` : `切换到窗口 ${windowNumber}：${tab.title}`}
        aria-pressed={selectionMode ? checked : isSelected} onClick={onClick} />
      <div className="tab-surface" onClick={e => {
        if ((e.target as Element).closest('button')) return;
        fixedHitAt(e.clientX, e.clientY)?.click();
      }}>
        <div className="tab-thumbnail" aria-hidden="true">
          {thumbnailUrl ? <img className="tab-screenshot" src={thumbnailUrl} alt="" draggable={false}
            onError={() => setThumbnail({ url: tab.url, image: null })} /> :
            <div className="tab-placeholder" title={tab.incognito ? '隐身页面不保存预览' : canCaptureUrl(tab.url) ? '浏览后自动生成预览' : '此页面不支持自动预览'}>
              <span className="placeholder-site">{tabDomain(tab.url)}</span>
              <span className="placeholder-title">{tab.title || '未命名标签页'}</span>
              <span className="placeholder-status"><ImageOff size={14} aria-hidden="true" />{tab.incognito ? '隐身页面' : canCaptureUrl(tab.url) ? '暂无预览' : '不支持预览'}</span>
            </div>}
          {image?.previous && <span className="thumbnail-badge">上次浏览</span>}
        </div>
        <div className="tab-caption">
          <span className="tab-favicon" aria-hidden="true"><Favicon key={tab.url} tab={tab} /></span>
          <div className="tab-caption-text" aria-hidden="true"><div className="tab-title">{tab.title || '未命名标签页'}</div><div className="tab-domain">{tabDomain(tab.url)}</div></div>
          <button type="button" className="tab-window tab-window-filter" disabled={disabled} aria-label={`只看窗口 ${windowNumber}`} onClick={e => { e.stopPropagation(); onFilterWindow(); }}>窗口 {windowNumber}</button>
          {tab.active && <span className="tab-active" aria-hidden="true" />}
        </div>
        {selectionMode ? <button type="button" className="tab-check" role="checkbox" aria-checked={checked} disabled={disabled}
          aria-label={`勾选标签页：${tab.title}`} onClick={onClick}>{checked && <Check size={17} aria-hidden="true" />}</button>
          : <button type="button" className="tab-close" disabled={disabled} aria-label={`关闭标签页：${tab.title}`} onClick={onClose}><X size={16} aria-hidden="true" /></button>}
      </div>
    </div>
  </div>;
});
