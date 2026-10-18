import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function ToolDialog({ title, busy = false, onClose, children, footer }: { title: string; busy?: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null, dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); (previous?.isConnected ? previous : document.querySelector<HTMLElement>('[aria-label="更多选项"]'))?.focus(); };
  }, []);
  useLayoutEffect(() => {
    if (busy && ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
  }, [busy]);
  return createPortal(<dialog ref={ref} tabIndex={-1} className="tool-dialog" aria-labelledby={titleId} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing && event.key === 'Escape') event.preventDefault();
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary')].filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
    }}>
    <div className="tool-dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="tool-icon" aria-label="关闭面板" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <div className="tool-dialog-body">{children}</div>
    {footer && <div className="tool-dialog-footer">{footer}</div>}
  </dialog>, document.body);
}
