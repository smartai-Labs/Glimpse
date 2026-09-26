import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Ellipsis, Search } from 'lucide-react';
import type { TitleKeyword } from '../lib/titleKeywords';

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  getKeywords: () => TitleKeyword[];
  onKeywordSelect: (term: string) => void;
}

export function SearchBar({ query, onQueryChange, inputRef, getKeywords, onKeywordSelect }: SearchBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const keywordsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const focusOnOpen = useRef<'first' | 'last' | null>(null);
  const focusAfterResize = useRef(false);
  const menuId = useId();
  const [visibleCount, setVisibleCount] = useState(0);
  const [open, setOpen] = useState(false);
  const keywords = useMemo(() => getKeywords(), [getKeywords]);
  const overflow = keywords.slice(visibleCount);
  const menuVisible = open && overflow.length > 0;

  useLayoutEffect(() => {
    const container = keywordsRef.current, measurements = measureRef.current;
    if (!container || !measurements) return;
    const measure = () => {
      const widths = [...measurements.querySelectorAll<HTMLElement>('.search-keyword')].map(node => node.getBoundingClientRect().width);
      const gap = parseFloat(getComputedStyle(container).columnGap) || 0;
      const available = container.clientWidth;
      const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap;
      let count = 0;
      if (total <= available) count = widths.length;
      else {
        let used = measurements.querySelector<HTMLElement>('.keyword-more')!.getBoundingClientRect().width;
        for (const width of widths) {
          if (used + gap + width > available) break;
          used += gap + width; count++;
        }
      }
      const focused = document.activeElement;
      const inline = [...container.querySelectorAll<HTMLButtonElement>(':scope > .search-keyword')];
      if (inline.indexOf(focused as HTMLButtonElement) >= count && inline.includes(focused as HTMLButtonElement)) focusAfterResize.current = true;
      setVisibleCount(count);
      if (count === widths.length) {
        if (menuRef.current?.contains(focused) || focused === moreRef.current) inputRef?.current?.focus();
        setOpen(false);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container); observer.observe(measurements);
    return () => observer.disconnect();
  }, [keywords, inputRef]);

  useLayoutEffect(() => {
    if (focusAfterResize.current) {
      // Wait until React reveals the overflow trigger before moving focus to it.
      focusAfterResize.current = false;
      moreRef.current?.focus();
    }
  }, [visibleCount]);

  useLayoutEffect(() => {
    const container = keywordsRef.current, trigger = moreRef.current, menu = menuRef.current;
    if (!menuVisible || !container || !trigger || !menu) return;
    const positionMenu = () => {
      const anchor = trigger.getBoundingClientRect(), rail = container.getBoundingClientRect();
      const width = menu.getBoundingClientRect().width;
      // Follow the button, clamping only when the menu would leave the viewport.
      const left = Math.max(12, Math.min(anchor.left, document.documentElement.clientWidth - width - 12));
      menu.style.left = `${left - rail.left}px`;
      menu.style.top = `${anchor.bottom - rail.top + 8}px`;
    };
    positionMenu();
    const observer = new ResizeObserver(positionMenu);
    observer.observe(container); observer.observe(trigger); observer.observe(menu);
    window.addEventListener('resize', positionMenu);
    return () => { observer.disconnect(); window.removeEventListener('resize', positionMenu); };
  }, [menuVisible, visibleCount, keywords]);

  useEffect(() => {
    // Title changes refresh the choices; never leave focus in a removed popup.
    const frame = requestAnimationFrame(() => {
      if (menuRef.current?.contains(document.activeElement)) inputRef?.current?.focus();
      setOpen(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [keywords, inputRef]);

  useEffect(() => {
    if (!menuVisible) return;
    if (focusOnOpen.current) {
      const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('button');
      (focusOnOpen.current === 'last' ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus();
      focusOnOpen.current = null;
    }
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuVisible]);

  function choose(term: string) {
    setOpen(false); onKeywordSelect(term); inputRef?.current?.focus();
  }
  function openMenu(edge: 'first' | 'last' = 'first') {
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('button');
    if (menuVisible) (edge === 'last' ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus();
    else { focusOnOpen.current = edge; setOpen(true); }
  }

  return <div ref={rootRef} className="overview-search-wrap"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
      if (event.key === 'Escape' && menuVisible) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) { setOpen(false); moreRef.current?.focus(); }
        return;
      }
      const inMenu = menuRef.current?.contains(event.target as Node);
      const buttons = inMenu
        ? [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        : [...(keywordsRef.current?.querySelectorAll<HTMLButtonElement>(':scope > button:not([hidden])') ?? [])];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      if (event.target === moreRef.current && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); openMenu(event.key === 'ArrowUp' ? 'last' : 'first'); return;
      }
      const keys = inMenu ? ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] : ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (!inMenu && event.key === 'ArrowUp') inputRef?.current?.focus();
      else if (event.key === 'Home') buttons[0]?.focus();
      else if (event.key === 'End') buttons.at(-1)?.focus();
      else buttons[(index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }}>
    <label className="overview-search"><Search size={17} aria-hidden="true" />
      <input ref={inputRef} type="search" aria-label="搜索标签页" placeholder="搜索标题、网址…" value={query}
        onFocus={() => setOpen(false)}
        onCompositionStart={() => { composing.current = true; setOpen(false); }}
        onCompositionEnd={() => { composing.current = false; }}
        onChange={event => onQueryChange(event.target.value)} />
    </label>
    {keywords.length > 0 && <div ref={keywordsRef} className="search-keywords" role="group" aria-label="从页面标题提取的快捷搜索词">
      {keywords.map((keyword, index) => <button key={keyword.term} type="button" className="search-keyword" hidden={index >= visibleCount}
        aria-pressed={query.trim().toLocaleLowerCase() === keyword.term.toLocaleLowerCase()}
        title={`搜索所有标签：${keyword.term}`} onClick={() => choose(keyword.term)}>{keyword.term}</button>)}
      <button ref={moreRef} type="button" className="keyword-more" hidden={!overflow.length}
        aria-label="更多快捷搜索词" title="更多快捷搜索词" aria-expanded={menuVisible} aria-controls={menuVisible ? menuId : undefined}
        onClick={() => { if (menuVisible) setOpen(false); else openMenu(); }}><Ellipsis size={17} aria-hidden="true" /></button>
      {menuVisible && <div ref={menuRef} id={menuId} className="keyword-menu" role="group" aria-label="更多快捷搜索词">
        {overflow.map(keyword => <button key={keyword.term} type="button" className="keyword-menu-item"
          aria-pressed={query.trim().toLocaleLowerCase() === keyword.term.toLocaleLowerCase()}
          onClick={() => choose(keyword.term)}>{keyword.term}</button>)}
      </div>}
      <div ref={measureRef} className="keyword-measurements" aria-hidden="true">
        {keywords.map(keyword => <span key={keyword.term} className="search-keyword">{keyword.term}</span>)}<span className="keyword-more" />
      </div>
    </div>}
  </div>;
}
