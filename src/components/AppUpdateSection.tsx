import { useEffect, useRef } from 'react';
import { Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n';
import { APP_VERSION, isUpdateBusy, type AppUpdater, type UpdateState } from '@/lib/appUpdater';

export interface AppUpdateControls {
  controller: AppUpdater;
  state: UpdateState;
}

interface AppUpdateSectionProps {
  updater?: AppUpdateControls;
  onBeforeInstall?: () => Promise<boolean>;
}

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

export function AppUpdateSection({ updater, onBeforeInstall }: AppUpdateSectionProps) {
  const { t } = useI18n();
  const state: UpdateState = updater?.state || { status: 'unsupported', currentVersion: APP_VERSION, downloadedBytes: 0 };
  const busy = isUpdateBusy(state.status);
  const canCheck = !busy && !['unsupported', 'downloaded', 'installed'].includes(state.status);
  const canDownload = state.status === 'available' || (state.status === 'error' && state.failedAction === 'download');
  const progress = state.totalBytes && state.totalBytes > 0
    ? Math.min(100, Math.round(state.downloadedBytes / state.totalBytes * 100)) : undefined;
  const prepare = onBeforeInstall || (async () => false);

  return (
    <section className="space-y-3" aria-labelledby="app-update-heading">
      <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
        <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
        <span id="app-update-heading">{t('updates.section')}</span>
      </div>
      <div className="space-y-3 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-panel p-3">
        <p className="font-medium text-slate-700 dark:text-slate-200">
          {t('updates.currentVersion', { version: state.currentVersion })}
          {state.version && <span className="ml-2 text-blue-600 dark:text-blue-400">→ v{state.version}</span>}
        </p>
        <p role="status" aria-live="polite" className="text-xs text-slate-500 dark:text-slate-400">
          {state.status === 'available' ? t('updates.available', { version: state.version || '' }) : t(`updates.${state.status}`)}
        </p>
        {state.notes && (
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs text-slate-600 dark:text-slate-300">
            {state.notes}
          </div>
        )}
        {state.status === 'downloading' && (
          <div className="space-y-1">
            <progress aria-label={t('updates.progress')} max={100} value={progress} className="h-2 w-full accent-blue-600" />
            <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {progress === undefined ? `${(state.downloadedBytes / 1048576).toFixed(1)} MB` : `${progress}%`}
            </p>
          </div>
        )}
        {state.error && (
          <p role="alert" className="break-words text-xs text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
        {(state.status === 'downloaded' || state.status === 'installed') && (
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{t('updates.saveBeforeInstall')}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={!canCheck} onClick={() => void updater?.controller.check()}>
            {state.status === 'checking' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t('updates.check')}
          </button>
          {canDownload && (
            <button type="button" className={buttonClass} onClick={() => void updater?.controller.download()}>
              <Download className="h-3.5 w-3.5" />
              {t(state.status === 'error' ? 'updates.retryDownload' : 'updates.download')}
            </button>
          )}
          {state.status === 'downloaded' && (
            <button type="button" className={buttonClass} disabled={!onBeforeInstall} onClick={() => void updater?.controller.install(prepare)}>
              {t('updates.install')}
            </button>
          )}
          {state.status === 'installed' && (
            <button type="button" className={buttonClass} disabled={!onBeforeInstall} onClick={() => void updater?.controller.restart(prepare)}>
              {t('updates.restart')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function UpdateInstallOverlay({ state }: { state: UpdateState }) {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  const open = ['preparing', 'installing', 'restarting'].includes(state.status);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    overlayRef.current?.focus();
    const blockKeys = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', blockKeys, true);
    return () => {
      window.removeEventListener('keydown', blockKeys, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div ref={overlayRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="update-install-status"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm outline-none">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-elevated p-6 text-sm text-slate-700 dark:text-slate-200 shadow-xl">
        <LoaderCircle className="h-5 w-5 animate-spin text-blue-500" />
        <span id="update-install-status">{t(`updates.${state.status}`)}</span>
      </div>
    </div>
  );
}
