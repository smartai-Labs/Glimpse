import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface QuickMenuProps {
  label: ReactNode;
  name: string;
  selected?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  children: (close: () => void) => ReactNode;
}

function MenuContents({ render, onClose }: { render: QuickMenuProps['children']; onClose: () => void }) { return <>{render(onClose)}</>; }

/** Small non-modal picker with one focus scope and viewport-bound positioning. */
export function QuickMenu({ label, name, selected, disabled, iconOnly, children }: QuickMenuProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const composing = useRef(false), lastOnOpen = useRef(false);
  const id = useId();
  function close() { setOpen(false); trigger.current?.focus(); }
  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return;
    const popup = panel.current, button = trigger.current;
    const position = () => {
      const rect = button.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 20, above = rect.top - 20;
      const upward = below < 180 && above > below;
      popup.style.maxHeight = Math.max(60, upward ? above : below) + 'px';
      const box = popup.getBoundingClientRect();
      popup.style.left = Math.max(12, Math.min(rect.left, innerWidth - box.width - 12)) + 'px';
      popup.style.top = Math.max(12, upward ? rect.top - box.height - 8 : rect.bottom + 8) + 'px';
    };
    position();
    const controls = [...popup.querySelectorAll<HTMLElement>('input, button:not(:disabled)')];
    (lastOnOpen.current ? controls.at(-1) : controls[0])?.focus();
    const observer = new ResizeObserver(position); observer.observe(button); observer.observe(popup);
    window.addEventListener('resize', position);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);
      window.removeEventListener('blur', blur);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className={'finder-trigger' + (iconOnly ? ' icon-only' : '')} disabled={disabled}
      data-selected={selected || undefined} aria-label={name} aria-description={typeof label === 'string' ? label : undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { lastOnOpen.current = false; setOpen(value => !value); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation(); lastOnOpen.current = event.key === 'ArrowUp'; setOpen(true);
        }
      }}><span className="finder-trigger-label">{label}</span>{!iconOnly && <ChevronDown size={13} aria-hidden="true" />}</button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={name} className="finder-menu"
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && !composing.current && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { close(); return; }
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
        if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) close(); return; }
        const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const inInput = event.target instanceof HTMLInputElement;
        if (event.key === 'Enter' && inInput) { event.preventDefault(); buttons[0]?.click(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || inInput && ['Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0)
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}><MenuContents render={children} onClose={close} /></div>, document.body)}
  </>;
}
