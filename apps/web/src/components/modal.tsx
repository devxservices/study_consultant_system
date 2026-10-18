'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from './ui';
import { IconClose } from './icons';

/**
 * A dialog on the browser's own <dialog>: focus moves into it and back,
 * Escape closes it, the page behind is inert, and a click on the backdrop
 * dismisses it. Shown while `open`; unmounting closes it.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="modal-title"
      className={cx(
        'popover m-auto w-[calc(100%-2rem)] rounded-xl bg-paper p-0 text-ink-900 shadow-raise backdrop:bg-ink-950/40 backdrop:backdrop-blur-[2px]',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="modal-title" className="text-[16px] font-semibold text-ink-950">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="press -m-1 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800">
              <IconClose size={18} />
              <span className="sr-only">Close</span>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
