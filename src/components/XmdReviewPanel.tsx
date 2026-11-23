import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { REVIEW_NOTE_LIMIT, type XmdReviewNote } from '@/lib/xmdReview';

export interface ReviewSelection { from: number; to: number; content: string }

export function XmdReviewPanel({ notes, draft, editable, onAdd, onUpdate, onLocate, onCancelDraft, onClose }: {
  notes: XmdReviewNote[];
  draft: ReviewSelection | null;
  editable: boolean;
  onAdd: (text: string) => boolean;
  onUpdate: (id: string, note?: XmdReviewNote) => void;
  onLocate: (note: XmdReviewNote) => void;
  onCancelDraft: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (draft) input.current?.focus(); }, [draft]);
  const visible = notes.filter((note) => showResolved || !note.resolved);
  const pending = notes.filter((note) => !note.resolved).length;
  return (
    <aside aria-label={t('xmdReview.title')}
      className="absolute inset-y-0 right-0 z-20 flex w-80 max-w-full shrink-0 flex-col border-l border-slate-200 bg-panel text-sm shadow-lg dark:border-slate-700 lg:relative lg:z-auto lg:shadow-none">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <h2 className="font-semibold">{t('xmdReview.title')} <span className="font-normal text-slate-500">{t('xmdReview.pending', { count: pending })}</span></h2>
        <button type="button" className="rounded p-1 hover:bg-elevated" onClick={onClose} aria-label={t('common.close')}><X size={16} /></button>
      </header>
      <div className="min-h-0 overflow-auto p-3">
        {draft && <form className="mb-4 space-y-2" onSubmit={(event) => {
          event.preventDefault();
          if (onAdd(text)) setText('');
        }}>
          <p className="line-clamp-3 break-all border-l-2 border-blue-400 pl-2 text-xs text-slate-500">{draft.content.slice(draft.from, draft.to)}</p>
          <textarea ref={input} aria-label={t('xmdReview.note')} placeholder={t('xmdReview.note')} rows={3} className="w-full rounded border border-slate-200 bg-elevated p-2 dark:border-slate-700"
            maxLength={REVIEW_NOTE_LIMIT} value={text} onChange={(event) => setText(event.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setText(''); onCancelDraft(); }} className="rounded px-2 py-1 hover:bg-elevated">{t('xmdReview.cancel')}</button>
            <button type="submit" disabled={!text.trim()} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">{t('xmdReview.add')}</button>
          </div>
        </form>}
        {notes.some((note) => note.resolved) && <label className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          {t('xmdReview.showResolved')}
        </label>}
        {!visible.length && !draft && <p className="text-sm text-slate-500">{t(notes.length ? 'xmdReview.done' : 'xmdReview.empty')}</p>}
        <ul className="space-y-2">
          {visible.map((note) => (
            <li key={note.id} className="rounded border border-slate-200 bg-elevated p-2.5 dark:border-slate-700">
              <button type="button" onClick={() => onLocate(note)} title={t('xmdReview.locate')}
                className="block max-w-full truncate text-left text-xs text-blue-700 hover:underline dark:text-blue-300">{note.quote}</button>
              <p className="mt-1 whitespace-pre-wrap break-words">{note.note}</p>
              {editable && <div className="mt-2 flex justify-end gap-1">
                <button type="button" onClick={() => onUpdate(note.id, { ...note, resolved: !note.resolved })}
                  aria-label={t(note.resolved ? 'xmdReview.reopen' : 'xmdReview.resolve')} title={t(note.resolved ? 'xmdReview.reopen' : 'xmdReview.resolve')}
                  className="rounded p-1 text-slate-500 hover:bg-panel">{note.resolved ? <RotateCcw size={15} /> : <Check size={15} />}</button>
                <button type="button" onClick={() => onUpdate(note.id)} aria-label={t('xmdReview.delete')} title={t('xmdReview.delete')}
                  className="rounded p-1 text-slate-500 hover:bg-panel hover:text-red-600"><Trash2 size={15} /></button>
              </div>}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
