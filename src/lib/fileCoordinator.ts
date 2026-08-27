import {
  isTauri as defaultIsTauri,
  subscribeOpenFiles as defaultSubscribeOpenFiles,
  drainPendingOpenFiles as defaultDrainPendingOpenFiles,
} from './native';

export interface FileCoordinatorOptions {
  /**
   * Function to drain pending file paths from native backend.
   * Defaults to `drainPendingOpenFiles`.
   */
  drainPendingFiles?: () => Promise<string[]>;

  /**
   * Handler called when pending file paths are drained.
   */
  onFilesReceived: (paths: string[]) => Promise<void> | void;

  /**
   * Function to check if running in Tauri desktop environment.
   * Defaults to `isTauri`.
   */
  isTauri?: () => boolean;

  /**
   * Function to subscribe to native 'open-files' wake event.
   * Defaults to `subscribeOpenFiles`.
   */
  subscribeOpenFiles?: (callback: () => void) => Promise<() => void>;

  /**
   * Polling interval in milliseconds for visible-window safety net in Tauri mode.
   * Defaults to 2000ms. Set to 0 to disable polling.
   */
  pollIntervalMs?: number;

  /**
   * Optional diagnostics logger.
   */
  debugLog?: (msg: string, ...args: unknown[]) => void;
}

export interface FileCoordinator {
  start: () => Promise<void>;
  stop: () => void;
  requestDrain: () => Promise<void>;
  isActive: () => boolean;
  isDraining: () => boolean;
}

/**
 * Creates a robust file drain coordinator to handle file association opens,
 * single-instance wake-ups, window focus restoration, visibility changes,
 * and background-suspension recovery.
 *
 * Guarantees:
 * 1. Single subscription lifecycle.
 * 2. Strict serialization & coalescing of drain requests to prevent overlapping operations,
 *    duplicate reads, toast spam, or tab race conditions.
 * 3. Multi-channel wake-up: Tauri 'open-files' event, window focus, visibility restoration.
 * 4. Low-overhead polling safety net when window is visible (only in Tauri mode).
 * 5. Clean teardown on stop / unmount.
 * 6. Safe graceful no-op in browser mode.
 */
export function createFileCoordinator(options: FileCoordinatorOptions): FileCoordinator {
  const drainPendingFiles = options.drainPendingFiles || defaultDrainPendingOpenFiles;
  const onFilesReceived = options.onFilesReceived;
  const checkIsTauri = options.isTauri || defaultIsTauri;
  const subscribeFn = options.subscribeOpenFiles || defaultSubscribeOpenFiles;
  const pollIntervalMs = options.pollIntervalMs !== undefined ? options.pollIntervalMs : 2000;
  const debugLog = options.debugLog;

  let active = false;
  let isDraining = false;
  let rerunRequested = false;
  let currentDrainPromise: Promise<void> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let nativeUnlisten: (() => void) | null = null;

  /**
   * Atomically requests a drain pass.
   * If a drain is already running, coalesces the request so another pass runs immediately after.
   */
  const requestDrain = async (): Promise<void> => {
    if (!active) {
      return;
    }

    if (isDraining) {
      // Coalesce: another drain pass is already executing.
      // Mark rerunRequested so that when the current cycle finishes,
      // it immediately drains again to pick up any paths that arrived in the interim.
      rerunRequested = true;
      return currentDrainPromise || Promise.resolve();
    }

    isDraining = true;
    rerunRequested = false;

    currentDrainPromise = (async () => {
      try {
        while (active) {
          rerunRequested = false;
          const rawPaths = await drainPendingFiles();

          if (!active) {
            break;
          }

          if (Array.isArray(rawPaths) && rawPaths.length > 0) {
            const validPaths = rawPaths
              .map((p) => (typeof p === 'string' ? p.trim() : ''))
              .filter((p) => p.length > 0);

            if (validPaths.length > 0) {
              if (debugLog) {
                debugLog('[FileCoordinator] Drained %d pending file(s)', validPaths.length);
              }
              await onFilesReceived(validPaths);
            }
          }

          // If no new request arrived while processing this cycle, we're done
          if (!rerunRequested || !active) {
            break;
          }
        }
      } catch (err) {
        console.warn('[FileCoordinator] Error while draining pending files:', err);
      } finally {
        isDraining = false;
        rerunRequested = false;
        currentDrainPromise = null;
      }
    })();

    return currentDrainPromise;
  };

  const handleFocus = () => {
    if (active) {
      requestDrain();
    }
  };

  const handleVisibilityChange = () => {
    if (active && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      requestDrain();
    }
  };

  const handlePoll = () => {
    if (!active) {
      return;
    }
    // Low-overhead check: only poll when document is visible
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    requestDrain();
  };

  const start = async (): Promise<void> => {
    if (active) {
      return;
    }
    active = true;

    // 1. Register DOM event listeners for window focus and visibility changes
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // 2. Setup low-overhead visible-window polling safety net in Tauri desktop mode
    const runningInTauri = checkIsTauri();
    if (runningInTauri && pollIntervalMs > 0) {
      pollTimer = setInterval(handlePoll, pollIntervalMs);
    }

    // 3. Subscribe to native wake-up signal (open-files event)
    if (runningInTauri && subscribeFn) {
      try {
        const unlisten = await subscribeFn(() => {
          if (active) {
            requestDrain();
          }
        });
        if (active) {
          nativeUnlisten = unlisten;
        } else {
          // If stopped while subscribing, cleanly unsubscribe immediately
          unlisten();
        }
      } catch (err) {
        console.warn('[FileCoordinator] Failed to subscribe to native open-files signal:', err);
      }
    }

    // 4. Initial atomic drain on start (cold start CLI arguments or pre-queued files)
    await requestDrain();
  };

  const stop = (): void => {
    active = false;
    rerunRequested = false;

    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', handleFocus);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }

    if (nativeUnlisten) {
      nativeUnlisten();
      nativeUnlisten = null;
    }
  };

  return {
    start,
    stop,
    requestDrain,
    isActive: () => active,
    isDraining: () => isDraining,
  };
}
