import { getVersion } from '@tauri-apps/api/app';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { version as APP_VERSION } from '../../package.json';
import { isTauri } from './native';

export { APP_VERSION };

export type UpdateStatus =
  | 'unsupported' | 'idle' | 'checking' | 'current' | 'available'
  | 'downloading' | 'downloaded' | 'preparing' | 'installing'
  | 'restarting' | 'installed' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  version?: string;
  notes?: string;
  downloadedBytes: number;
  totalBytes?: number;
  error?: string;
  failedAction?: 'check' | 'download' | 'install' | 'restart';
}

export type PendingUpdate = Pick<Update, 'version' | 'currentVersion' | 'body' | 'download' | 'install' | 'close'>;

export interface UpdaterBackend {
  enabled: boolean;
  getVersion: () => Promise<string>;
  check: () => Promise<PendingUpdate | null>;
  relaunch: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isUpdateBusy(status: UpdateStatus): boolean {
  return ['checking', 'downloading', 'preparing', 'installing', 'restarting'].includes(status);
}

/** Keeps the native update resource alive across closing/reopening settings. */
export class AppUpdater {
  private state: UpdateState;
  private pending: PendingUpdate | null = null;
  private listeners = new Set<() => void>();

  constructor(private backend: UpdaterBackend) {
    this.state = {
      status: backend.enabled ? 'idle' : 'unsupported',
      currentVersion: APP_VERSION,
      downloadedBytes: 0,
    };
  }

  getSnapshot = (): UpdateState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private async release(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    await pending?.close().catch(() => {});
  }

  check = async (): Promise<boolean> => {
    if (!this.backend.enabled || isUpdateBusy(this.state.status) ||
        ['downloaded', 'installed'].includes(this.state.status)) return false;
    this.set({ status: 'checking', version: undefined, notes: undefined, error: undefined, failedAction: undefined, downloadedBytes: 0, totalBytes: undefined });
    try {
      await this.release();
      this.set({ currentVersion: await this.backend.getVersion() });
      this.pending = await this.backend.check();
      this.set(this.pending ? {
        status: 'available', version: this.pending.version, notes: this.pending.body,
        currentVersion: this.pending.currentVersion,
      } : { status: 'current' });
      return this.pending !== null;
    } catch (error) {
      this.set({ status: 'error', error: errorMessage(error), failedAction: 'check' });
      return false;
    }
  };

  download = async (): Promise<void> => {
    if (!this.pending || !(this.state.status === 'available' ||
        (this.state.status === 'error' && this.state.failedAction === 'download'))) return;
    this.set({ status: 'downloading', downloadedBytes: 0, totalBytes: undefined, error: undefined, failedAction: undefined });
    let downloadedBytes = 0;
    let lastProgressReport = 0;
    try {
      await this.pending.download((event: DownloadEvent) => {
        if (event.event === 'Started') {
          downloadedBytes = 0;
          this.set({ totalBytes: event.data.contentLength, downloadedBytes: 0 });
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          // Keep a fast download from re-rendering the editor for every chunk.
          const now = Date.now();
          if (now - lastProgressReport >= 100) {
            lastProgressReport = now;
            this.set({ downloadedBytes });
          }
        } else if (event.event === 'Finished') {
          this.set({ downloadedBytes });
        }
        // Finished only means the transfer ended. The download promise must
        // also resolve (including signature verification) before installing.
      }, { timeout: 120_000 });
      this.set({ status: 'downloaded', downloadedBytes });
    } catch (error) {
      this.set({ status: 'error', error: errorMessage(error), failedAction: 'download' });
    }
  };

  install = async (prepare: () => Promise<boolean>): Promise<void> => {
    if (!this.pending || this.state.status !== 'downloaded') return;
    this.set({ status: 'preparing', error: undefined, failedAction: undefined });
    try {
      if (!await prepare()) {
        this.set({ status: 'downloaded' });
        return;
      }
    } catch (error) {
      this.set({ status: 'downloaded', error: errorMessage(error) });
      return;
    }
    this.set({ status: 'installing' });
    try {
      await this.pending.install();
    } catch (error) {
      await this.release();
      this.set({ status: 'error', error: errorMessage(error), failedAction: 'install' });
      return;
    }
    await this.release();
    // Windows exits when it launches the installer, which restarts the app.
    // macOS/Linux return from install and need an explicit restart.
    await this.relaunchInstalled();
  };

  restart = async (prepare: () => Promise<boolean>): Promise<void> => {
    if (this.state.status !== 'installed') return;
    this.set({ status: 'preparing', error: undefined });
    try {
      if (!await prepare()) {
        this.set({ status: 'installed' });
        return;
      }
    } catch (error) {
      this.set({ status: 'installed', error: errorMessage(error), failedAction: 'restart' });
      return;
    }
    await this.relaunchInstalled();
  };

  private async relaunchInstalled(): Promise<void> {
    this.set({ status: 'restarting', error: undefined, failedAction: undefined });
    try {
      await this.backend.relaunch();
      this.set({ status: 'installed' });
    } catch (error) {
      this.set({ status: 'installed', error: errorMessage(error), failedAction: 'restart' });
    }
  }
}

export function createNativeUpdater(): AppUpdater {
  return new AppUpdater({
    enabled: isTauri(),
    getVersion,
    check: async () => (await import('@tauri-apps/plugin-updater')).check({ timeout: 15_000 }),
    relaunch: async () => (await import('@tauri-apps/plugin-process')).relaunch(),
  });
}
