import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { useI18n } from '@/i18n';
import { importDocx, MAX_DOCX_IMPORT_BYTES } from '@/lib/importDocx';
import { WorkflowDialog } from './WorkflowDialog';

export function WordImportDialog({ onImport, onClose }: {
  onImport: (title: string, markdown: string, skippedImages: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [layout, setLayout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await importDocx(await file.arrayBuffer(), layout);
      const title = file.name.replace(/\.docx$/i, layout ? '.xmd' : '.md');
      onImport(title, result.markdown, result.skippedImages);
    } catch {
      setError(t('wordImport.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WorkflowDialog title={t('wordImport.title')} onClose={onClose} busy={busy}>
      <form className="space-y-4 overflow-auto p-4" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('wordImport.description')}</p>
        <input ref={input} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = '';
            const valid = selected && /\.docx$/i.test(selected.name) && selected.size > 0 && selected.size <= MAX_DOCX_IMPORT_BYTES;
            setFile(valid ? selected : null);
            setError(selected && !valid ? t('wordImport.invalid') : '');
          }} />
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" disabled={busy} onClick={() => input.current?.click()}
            className="inline-flex shrink-0 items-center gap-2 rounded border border-slate-200 px-3 py-1.5 text-sm hover:bg-panel dark:border-slate-700">
            <FileUp size={15} />{t('wordImport.choose')}
          </button>
          {file && <span className="truncate text-sm" title={file.name}>{file.name}</span>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={layout} disabled={busy} onChange={(event) => setLayout(event.target.checked)} />
          {t('wordImport.layout')}
        </label>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={!file || busy} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {t(busy ? 'wordImport.importing' : 'wordImport.apply')}
          </button>
        </div>
      </form>
    </WorkflowDialog>
  );
}
