import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/i18n';

export function WorkflowDialog({ title, onClose, busy = false, children }: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      className="m-auto w-[44rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-elevated text-slate-800 shadow-xl backdrop:bg-black/50 dark:border-slate-700 dark:text-slate-100"
    >
      <div className="flex max-h-[calc(100vh-2rem)] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold" id={id}>{title}</h2>
          <button
            type="button" disabled={busy} onClick={onClose}
            aria-label={t('common.close')}
            className="rounded p-1 text-slate-500 hover:bg-panel disabled:opacity-40"
          ><X className="w-4 h-4" /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
