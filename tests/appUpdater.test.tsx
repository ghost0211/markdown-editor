import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppUpdater, APP_VERSION, type PendingUpdate, type UpdateState } from '../src/lib/appUpdater';
import { prepareDocumentsForUpdate } from '../src/lib/appUpdateDocuments';
import { AppUpdateSection } from '../src/components/AppUpdateSection';
import { I18nProvider } from '../src/i18n';
import { createDefaultTab } from '../src/lib/documentUtils';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(enabled = true) {
  const update: PendingUpdate = {
    version: '1.7.0', currentVersion: APP_VERSION, body: 'Formula rendering improvements',
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const backend = {
    enabled,
    getVersion: vi.fn().mockResolvedValue(APP_VERSION),
    check: vi.fn().mockResolvedValue(update),
    relaunch: vi.fn().mockResolvedValue(undefined),
  };
  return { update, backend, updater: new AppUpdater(backend) };
}

describe('application updater', () => {
  it('does not invoke desktop APIs in a browser', async () => {
    const { updater, backend } = setup(false);
    expect(updater.getSnapshot().status).toBe('unsupported');
    await updater.check();
    await updater.download();
    await updater.install(vi.fn());
    expect(backend.check).not.toHaveBeenCalled();
    expect(backend.getVersion).not.toHaveBeenCalled();
  });

  it('reports an up-to-date application only after a successful check with no update', async () => {
    const { updater, backend } = setup();
    backend.check.mockResolvedValue(null);
    expect(await updater.check()).toBe(false);
    expect(updater.getSnapshot().status).toBe('current');
    backend.check.mockRejectedValue(new Error('HTTP 404: latest.json'));
    await updater.check();
    expect(updater.getSnapshot()).toMatchObject({ status: 'error', failedAction: 'check', error: 'HTTP 404: latest.json' });
  });

  it('suppresses overlapping checks and releases the previous update before checking again', async () => {
    const { updater, backend, update } = setup();
    const request = deferred<PendingUpdate>();
    backend.check.mockReturnValueOnce(request.promise);
    const first = updater.check();
    expect(await updater.check()).toBe(false);
    request.resolve(update);
    expect(await first).toBe(true);
    expect(backend.check).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot()).toMatchObject({ status: 'available', version: '1.7.0' });
    await updater.check();
    expect(update.close).toHaveBeenCalledTimes(1);
  });

  it('keeps a download in progress until signature verification resolves, even after Finished', async () => {
    const { updater, update } = setup();
    const verified = deferred<void>();
    vi.mocked(update.download).mockImplementation(async onEvent => {
      onEvent?.({ event: 'Started', data: { contentLength: 100 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 30 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 70 } });
      onEvent?.({ event: 'Finished' });
      return verified.promise;
    });
    await updater.check();
    const download = updater.download();
    expect(updater.getSnapshot()).toMatchObject({ status: 'downloading', downloadedBytes: 100, totalBytes: 100 });
    await updater.download();
    expect(update.download).toHaveBeenCalledTimes(1);
    const prepare = vi.fn().mockResolvedValue(true);
    await updater.install(prepare);
    expect(prepare).not.toHaveBeenCalled();
    verified.resolve();
    await download;
    expect(updater.getSnapshot().status).toBe('downloaded');
  });

  it('handles unknown download sizes and allows retry after a failed signature/download', async () => {
    const { updater, update } = setup();
    vi.mocked(update.download).mockImplementationOnce(async onEvent => {
      onEvent?.({ event: 'Started', data: {} });
      onEvent?.({ event: 'Progress', data: { chunkLength: 500 } });
      onEvent?.({ event: 'Finished' });
      throw new Error('signature verification failed');
    });
    await updater.check();
    await updater.download();
    expect(updater.getSnapshot()).toMatchObject({ status: 'error', failedAction: 'download', downloadedBytes: 500 });
    expect(updater.getSnapshot().totalBytes).toBeUndefined();
    await updater.install(vi.fn().mockResolvedValue(true));
    expect(update.install).not.toHaveBeenCalled();
    await updater.download();
    expect(updater.getSnapshot().status).toBe('downloaded');
  });

  it('retains a verified download when saving is canceled and never launches the installer', async () => {
    const { updater, update, backend } = setup();
    await updater.check();
    await updater.download();
    await updater.install(vi.fn().mockResolvedValue(false));
    expect(updater.getSnapshot().status).toBe('downloaded');
    expect(update.install).not.toHaveBeenCalled();
    expect(backend.relaunch).not.toHaveBeenCalled();
    expect(update.close).not.toHaveBeenCalled();
    await updater.install(async () => { throw new Error('save failed'); });
    expect(updater.getSnapshot()).toMatchObject({ status: 'downloaded', error: 'save failed' });
    expect(update.install).not.toHaveBeenCalled();
    expect(update.close).not.toHaveBeenCalled();
  });

  it('awaits document saves before installation and suppresses repeated install clicks', async () => {
    const { updater, update, backend } = setup();
    await updater.check();
    await updater.download();
    const saved = deferred<boolean>();
    const prepare = vi.fn(() => saved.promise);
    const install = updater.install(prepare);
    await updater.install(prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot().status).toBe('preparing');
    expect(update.install).not.toHaveBeenCalled();
    saved.resolve(true);
    await install;
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(backend.relaunch).toHaveBeenCalledTimes(1);
  });

  it('never restarts when installation fails and requires a fresh update check', async () => {
    const { updater, update, backend } = setup();
    vi.mocked(update.install).mockRejectedValue(new Error('installer could not start'));
    await updater.check();
    await updater.download();
    await updater.install(async () => true);
    expect(updater.getSnapshot()).toMatchObject({ status: 'error', failedAction: 'install' });
    expect(update.close).toHaveBeenCalledOnce();
    expect(backend.relaunch).not.toHaveBeenCalled();
    await updater.check();
    expect(updater.getSnapshot().status).toBe('available');
  });

  it('retries only the restart after a successful install when restart fails', async () => {
    const { updater, update, backend } = setup();
    backend.relaunch.mockRejectedValueOnce(new Error('restart failed'));
    await updater.check();
    await updater.download();
    await updater.install(async () => true);
    expect(updater.getSnapshot()).toMatchObject({ status: 'installed', failedAction: 'restart' });
    await updater.restart(async () => false);
    expect(backend.relaunch).toHaveBeenCalledTimes(1);
    await updater.restart(async () => true);
    expect(backend.relaunch).toHaveBeenCalledTimes(2);
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(update.download).toHaveBeenCalledTimes(1);
  });
});

describe('saving documents before updating', () => {
  it('saves all dirty documents, ignores compare tabs, then flushes the session', async () => {
    const tabs = [
      { ...createDefaultTab('a', 'a'), isDirty: true },
      { ...createDefaultTab('b', 'b'), isDirty: true },
      { ...createDefaultTab('comparison'), kind: 'diff' as const, isDirty: true },
    ];
    const flush = vi.fn();
    const save = vi.fn(async (ids: string[]) => {
      expect(flush).not.toHaveBeenCalled();
      tabs.forEach(tab => { if (ids.includes(tab.id)) tab.isDirty = false; });
      return true;
    });
    expect(await prepareDocumentsForUpdate(() => tabs, save, flush)).toBe(true);
    expect(save).toHaveBeenCalledWith(tabs.slice(0, 2).map(tab => tab.id));
    expect(flush).toHaveBeenCalledOnce();
  });

  it('blocks installation if saving is canceled or a new dirty document appears during a native dialog', async () => {
    const tabs = [createDefaultTab('saved')];
    const flush = vi.fn();
    expect(await prepareDocumentsForUpdate(() => tabs, async () => false, flush)).toBe(false);
    expect(await prepareDocumentsForUpdate(() => tabs, async () => {
      tabs.push({ ...createDefaultTab('new'), isDirty: true });
      return true;
    }, flush)).toBe(false);
    expect(flush).not.toHaveBeenCalled();
  });
});

describe('update settings interface', () => {
  function render(state: Partial<UpdateState>, language: 'zh-CN' | 'en-US' = 'zh-CN') {
    const { updater } = setup();
    return renderToStaticMarkup(
      <I18nProvider language={language}>
        <AppUpdateSection updater={{ controller: updater, state: { currentVersion: APP_VERSION, downloadedBytes: 0, status: 'idle', ...state } }} onBeforeInstall={async () => true} />
      </I18nProvider>
    );
  }

  it('shows a disabled check button in the browser and renders both languages', () => {
    expect(render({ status: 'unsupported' })).toContain('已安装的桌面应用');
    expect(render({ status: 'unsupported' })).toContain('disabled=""');
    expect(render({ status: 'current' }, 'en-US')).toContain('latest version');
  });

  it('escapes release notes and offers a separate install button only after a verified download', () => {
    const available = render({ status: 'available', version: '1.7.0', notes: '<script>alert(1)</script>' });
    expect(available).toContain('&lt;script&gt;');
    expect(available).not.toContain('>保存并安装更新<');
    expect(render({ status: 'downloaded' })).toContain('>保存并安装更新<');
    expect(render({ status: 'installed' })).toContain('>保存并重启<');
  });

  it('shows real progress or indeterminate progress without NaN', () => {
    expect(render({ status: 'downloading', downloadedBytes: 25, totalBytes: 100 })).toContain('value="25"');
    const unknown = render({ status: 'downloading', downloadedBytes: 1024 });
    expect(unknown).not.toContain('NaN');
    expect(unknown).not.toMatch(/<progress[^>]*value=/);
  });
});
