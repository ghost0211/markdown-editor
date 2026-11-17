import { useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, FileText, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';
import { deleteSnippet, expandTemplate, getBuiltInTemplates, loadSnippetAuthor, loadSnippets, saveSnippet, saveSnippetAuthor, type Snippet } from '@/lib/templates';

interface TemplateManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateDocument: (title: string, content: string) => void;
  onInsert: (content: string) => void;
}

export function TemplateManager({ isOpen, onClose, onCreateDocument, onInsert }: TemplateManagerProps) {
  const { t, language } = useI18n();
  const [selectedId, setSelectedId] = useState('meeting-minutes');
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [author, setAuthor] = useState('');
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const templates = useMemo(() => getBuiltInTemplates(language), [language]);

  useEffect(() => {
    if (!isOpen) return;
    setSnippets(loadSnippets()); setAuthor(loadSnippetAuthor()); setError('');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])')];
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [isOpen]);

  const snippet = snippets.find((item) => item.id === selectedId);
  const template = templates.find((item) => item.id === selectedId);
  const expanded = useMemo(() => expandTemplate(snippet?.body || template?.body || '', { title: title || (snippet?.title ?? (template ? t(template.nameKey as TranslationKey) : '')), author }), [author, snippet, t, template, title]);
  if (!isOpen) return null;

  const save = () => {
    const result = saveSnippet({ title, body, author }, { id: editingId });
    if (!result.ok) {
      setError(t(`templates.error${result.error.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}` as TranslationKey));
      return;
    }
    saveSnippetAuthor(author); setSnippets(result.snippets); setSelectedId(result.snippet.id); setEditing(false); setEditingId(undefined); setError('');
  };

  const remove = (id: string) => {
    const result = deleteSnippet(id);
    if (!result.ok) { setError(t('templates.errorStorageUnavailable')); return; }
    setSnippets(result.snippets); if (selectedId === id) setSelectedId('meeting-minutes');
    if (editingId === id) { setEditing(false); setEditingId(undefined); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="template-manager-title" className="w-[850px] max-w-[calc(100vw-2rem)] h-[75vh] max-h-[700px] min-h-[400px] bg-elevated border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl flex flex-col overflow-hidden text-slate-800 dark:text-slate-100">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2 id="template-manager-title" className="text-sm font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" />{t('templates.title')}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('templates.close')} className="p-1 rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"><X className="w-4 h-4" /></button>
        </header>
        <div className="flex flex-col sm:flex-row flex-1 min-h-0">
          <div className="w-full sm:w-64 shrink-0 max-h-[40%] sm:max-h-none overflow-y-auto border-b sm:border-b-0 sm:border-r border-slate-200 dark:border-slate-700 p-2 space-y-1">
            <p className="px-2 py-1 text-[10px] text-slate-500">{t('templates.builtins')}</p>
            {templates.map((item) => <button key={item.id} type="button" aria-current={selectedId === item.id ? 'true' : undefined} onClick={() => { setSelectedId(item.id); setTitle(t(item.nameKey as TranslationKey)); }} className={`w-full text-left px-2 py-2 rounded ${selectedId === item.id ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}><span className="block text-xs font-medium">{t(item.nameKey as TranslationKey)}</span><span className="block text-[10px] mt-1 text-slate-500">{t(item.descriptionKey as TranslationKey)}</span></button>)}
            <div className="flex items-center justify-between px-2 pt-2"><p className="text-[10px] text-slate-500">{t('templates.custom')}</p><button type="button" onClick={() => { setEditing(true); setEditingId(undefined); setTitle(''); setBody(''); }} aria-label={t('templates.newSnippet')} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"><Plus className="w-3.5 h-3.5" /></button></div>
            {snippets.map((item) => <div key={item.id} className={`rounded ${selectedId === item.id ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}><button type="button" onClick={() => { setSelectedId(item.id); setTitle(item.title); setAuthor(item.author); }} className="w-full text-left px-2 py-1.5 text-xs truncate">{item.title}</button><div className="flex px-2 pb-1 gap-2"><button type="button" onClick={() => { setSelectedId(item.id); setEditingId(item.id); setTitle(item.title); setBody(item.body); setAuthor(item.author); setEditing(true); }} className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1"><Pencil className="w-3 h-3" />{t('templates.edit')}</button><button type="button" onClick={() => remove(item.id)} className="text-[10px] text-red-500 flex items-center gap-1"><Trash2 className="w-3 h-3" />{t('templates.delete')}</button></div></div>)}
          </div>
          <main className="flex-1 min-w-0 overflow-y-auto p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs">{t('templates.documentTitle')}<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} className="block w-full mt-1 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-app" /></label><label className="text-xs">{t('templates.author')}<input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={80} className="block w-full mt-1 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-app" /></label></div>
            <p className="text-[10px] text-slate-500">{t('templates.variables')}</p>
            <pre aria-label={t('templates.preview')} className="min-h-28 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 text-[11px] font-mono">{expanded || t('templates.emptyPreview')}</pre>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={!expanded.trim()} onClick={() => { onCreateDocument(title || t('common.untitledDoc'), expanded); onClose(); }} className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs flex items-center gap-1.5 disabled:opacity-40"><FilePlus2 className="w-3.5 h-3.5" />{t('templates.createDocument')}</button><button type="button" disabled={!expanded} onClick={() => { onInsert(expanded); onClose(); }} className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-xs">{t('templates.insert')}</button></div>
            <button type="button" onClick={() => { setEditing((value) => !value); if (!editing) { setEditingId(undefined); setTitle(''); setBody(''); } }} className="text-xs text-blue-600 dark:text-blue-400">{editing ? t('templates.hideEditor') : t('templates.showEditor')}</button>
            {editing && <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2"><label className="block text-xs">{t('templates.snippetBody')}<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} className="block w-full mt-1 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-app font-mono" /></label>{error && <p role="alert" className="text-xs text-red-500">{error}</p>}<button type="button" onClick={save} className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs flex items-center gap-1.5"><Save className="w-3.5 h-3.5" />{t('templates.saveSnippet')}</button></div>}
          </main>
        </div>
      </div>
    </div>
  );
}
