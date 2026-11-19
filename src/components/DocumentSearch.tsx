import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Code2,
  Eye,
  FileText,
  LoaderCircle,
  MapPin,
  Regex,
  RefreshCw,
  Replace,
  ReplaceAll,
  Search,
  ShieldCheck,
  WholeWord,
  X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import type { ToastType } from '@/types';
import { loadWorkspaceSearch, workspaceSearchDocuments, type WorkspaceSearchSnapshot } from '@/lib/workspaceSearch';
import {
  MAX_REPLACEMENT_OUTPUT_LENGTH,
  PER_TAB_MATCH_LIMIT,
  SEARCH_DEBOUNCE_MS,
  SEARCH_WORKER_STARTUP_TIMEOUT_MS,
  SEARCH_WORKER_TIMEOUT_MS,
  TOTAL_MATCH_LIMIT,
  SearchError,
  buildSearchPattern,
  formatSearchSnippet,
  searchDocuments,
  selectSearchTabs,
  type ExpandedReplacement,
  type ReplacePreviewSample,
  type ReplaceUpdate,
  type SearchErrorCode,
  type SearchMatch,
  type SearchOptions,
  type SearchOutcome,
  type SearchScope,
  type SearchTabInput,
  type SearchWorkerRequest,
  type SearchWorkerResponse,
} from '@/lib/documentSearch';

export interface DocumentSearchProps {
  isOpen: boolean;
  onClose: () => void;
  /** All open tabs. Diff tabs are filtered out by the component. */
  tabs: SearchTabInput[];
  activeTabId: string;
  /** Reveals a match in the editor (offsets are UTF-16 offsets in the buffer). */
  onLocate: (tabId: string, from: number, to: number) => void;
  workspaceRoot?: string | null;
  onChooseWorkspace?: () => Promise<void>;
  onLocateWorkspace?: (filePath: string, match: SearchMatch, original: string) => Promise<boolean>;
  /**
   * Applies buffer replacements. `original` is the exact content the match
   * offsets were computed against; the host must reject the whole batch when
   * any `original` no longer matches the live buffer. Returns success.
   */
  onApply: (
    updates: { id: string; original: string; content: string }[]
  ) => boolean;
  /** Optional host toast; the modal also renders its own status text. */
  showToast?: (message: string, type?: ToastType, duration?: number) => void;
}

interface SearchRun {
  outcome: SearchOutcome;
  docs: SearchTabInput[];
  options: SearchOptions;
  /** Search identity (query/options/scope/doc ids), never document contents. */
  signature: string;
}

interface ReplacePreviewState {
  signature: string;
  total: number;
  tabCount: number;
  samples: ReplacePreviewSample[];
  truncated: boolean;
  protectedMatches: number;
  /** Worker-computed full buffers, valid only while `original` still matches. */
  updates: ReplaceUpdate[];
  /** Worker-computed replacement text for each match, used by "replace current". */
  expansions: ExpandedReplacement[];
}

interface SearchFailure {
  code: SearchErrorCode;
  detail?: string;
}

interface PendingWorkerRequest {
  id: number;
  resolve: (response: SearchWorkerResponse) => void;
  reject: (error: SearchError) => void;
  startupTimer: number;
  computeTimer: number | null;
}

const RESULT_PAGE_SIZE = 200;
type Scope = SearchScope | 'workspace';
const OPEN_TAB_SCOPES: readonly Scope[] = ['current', 'all'];
const ALL_SCOPES: readonly Scope[] = ['current', 'all', 'workspace'];

function makeSearchSignature(
  docs: readonly SearchTabInput[],
  options: SearchOptions,
  scope: Scope
): string {
  return JSON.stringify({
    scope,
    query: options.query,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    regex: options.regex,
    skipCode: Boolean(options.skipCode),
    ids: docs.map((doc) => doc.id),
  });
}

function toSearchFailure(error: unknown): SearchFailure {
  if (error instanceof SearchError) {
    return { code: error.code, detail: error.detail ?? error.message };
  }
  return {
    code: 'internal',
    detail: error instanceof Error ? error.message : String(error),
  };
}

export const DocumentSearch: React.FC<DocumentSearchProps> = ({
  isOpen,
  onClose,
  tabs,
  activeTabId,
  onLocate,
  workspaceRoot,
  onChooseWorkspace,
  onLocateWorkspace,
  onApply,
  showToast,
}) => {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState<Scope>('current');
  const workspace = scope === 'workspace';
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [workspaceScan, setWorkspaceScan] = useState<{
    key: string;
    snapshot?: WorkspaceSearchSnapshot;
    error?: string;
  } | null>(null);
  const workspaceKey = JSON.stringify([workspaceRoot, workspaceRevision]);
  const workspaceState = workspaceScan?.key === workspaceKey ? workspaceScan : null;
  const workspaceLoading = workspace && Boolean(workspaceRoot) && !workspaceState;
  const locateWorkspaceBusy = useRef(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [skipCode, setSkipCode] = useState(false);
  const [run, setRun] = useState<SearchRun | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [searchFailure, setSearchFailure] = useState<SearchFailure | null>(null);
  const [activeMatch, setActiveMatch] = useState(0);
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const [preview, setPreview] = useState<ReplacePreviewState | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    tone: 'success' | 'warning';
  } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pendingRequestRef = useRef<PendingWorkerRequest | null>(null);
  const requestIdRef = useRef(0);
  const generationRef = useRef(0);
  const applyLockRef = useRef(false);
  const inputSignatureRef = useRef('');
  const skipFocusRestoreRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const options = useMemo<SearchOptions>(
    () => ({
      query,
      caseSensitive,
      wholeWord,
      regex,
      skipCode,
    }),
    [query, caseSensitive, wholeWord, regex, skipCode]
  );

  useEffect(() => {
    if (!isOpen || !workspace || !workspaceRoot) return;
    const controller = new AbortController();
    loadWorkspaceSearch(workspaceRoot, controller.signal).then(
      (snapshot) => {
        if (!controller.signal.aborted) setWorkspaceScan({ key: workspaceKey, snapshot });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setWorkspaceScan({ key: workspaceKey, error: error instanceof Error ? error.message : String(error) });
        }
      }
    );
    return () => controller.abort();
  }, [isOpen, workspace, workspaceKey, workspaceRoot]);

  const workspaceSnapshot = workspaceState?.snapshot;
  const selection = useMemo(() => {
    if (scope !== 'workspace') return selectSearchTabs(tabs, activeTabId, scope);
    return {
      docs: workspaceSnapshot ? workspaceSearchDocuments(workspaceSnapshot, tabs) : [],
      activeUnavailable: false,
    };
  }, [tabs, activeTabId, scope, workspaceSnapshot]);
  const docs = selection.docs;
  const searchSignature = useMemo(
    () => makeSearchSignature(docs, options, scope),
    [docs, options, scope]
  );
  const inputSignature = useMemo(
    () => JSON.stringify({ search: searchSignature, replacement }),
    [searchSignature, replacement]
  );
  inputSignatureRef.current = inputSignature;

  const liveContent = useMemo(
    () => new Map((workspace ? docs : tabs).map((tab) => [tab.id, tab.content])),
    [docs, tabs, workspace]
  );

  const isStale = useMemo(() => {
    if (!run) return false;
    return run.docs.some((doc) => liveContent.get(doc.id) !== doc.content);
  }, [run, liveContent]);

  const runIsCurrent = Boolean(run && run.signature === searchSignature);
  const previewIsFresh = Boolean(
    preview && preview.signature === inputSignature
  );
  const flatMatches = useMemo(
    () => run?.outcome.results.flatMap((result) => result.matches) ?? [],
    [run]
  );
  const runContentById = useMemo(
    () => new Map((run?.docs ?? []).map((doc) => [doc.id, doc.content])),
    [run]
  );
  const titleById = useMemo(
    () =>
      new Map(
        (run?.outcome.results ?? []).map((result) => [result.tabId, result.title])
      ),
    [run]
  );
  const docResults = useMemo(
    () =>
      (run?.outcome.results ?? []).filter(
        (result) => result.matches.length > 0
      ),
    [run]
  );
  const firstMatchIndexByTab = useMemo(() => {
    const map = new Map<string, number>();
    let index = 0;
    for (const result of run?.outcome.results ?? []) {
      if (result.matches.length > 0) map.set(result.tabId, index);
      index += result.matches.length;
    }
    return map;
  }, [run]);

  const clearPendingRequest = useCallback((rejectWith?: SearchError) => {
    const pending = pendingRequestRef.current;
    if (!pending) return;
    pendingRequestRef.current = null;
    window.clearTimeout(pending.startupTimer);
    if (pending.computeTimer !== null) {
      window.clearTimeout(pending.computeTimer);
    }
    if (rejectWith) pending.reject(rejectWith);
  }, []);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clearPendingRequest(new SearchError('cancelled', 'Search cancelled'));
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [clearPendingRequest]);

  useEffect(() => {
    if (isOpen) return;
    generationRef.current += 1;
    clearPendingRequest(new SearchError('cancelled', 'Search cancelled'));
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsSearching(false);
    setIsPreviewing(false);
    setSearchFailure(null);
    setRun(null);
    setPreview(null);
    setStatusMessage(null);
  }, [isOpen, clearPendingRequest]);

  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = new Worker(
        new URL('../workers/documentSearch.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;
      return worker;
    } catch {
      return null;
    }
  }, []);

  /**
   * Sends one request to the search worker. The timeout starts when the worker
   * confirms it has loaded (`started`), so a slow cold module load does not
   * look like a catastrophic regex. A separate startup watchdog still covers a
   * worker that never loads.
   */
  const requestWorker = useCallback(
    (build: (id: number) => SearchWorkerRequest): Promise<SearchWorkerResponse> => {
      const worker = ensureWorker();
      if (!worker) {
        return Promise.reject(
          new SearchError('worker-unavailable', 'Web Worker unavailable')
        );
      }

      if (pendingRequestRef.current) {
        clearPendingRequest(new SearchError('cancelled', 'Search superseded'));
      }

      const id = ++requestIdRef.current;
      return new Promise<SearchWorkerResponse>((resolve, reject) => {
        const pending: PendingWorkerRequest = {
          id,
          resolve,
          reject,
          startupTimer: 0,
          computeTimer: null,
        };

        const clearTimers = () => {
          window.clearTimeout(pending.startupTimer);
          if (pending.computeTimer !== null) {
            window.clearTimeout(pending.computeTimer);
          }
        };

        const fail = (error: SearchError) => {
          if (pendingRequestRef.current !== pending) return;
          pendingRequestRef.current = null;
          clearTimers();
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          reject(error);
        };

        const armComputeTimeout = () => {
          window.clearTimeout(pending.startupTimer);
          if (pending.computeTimer !== null) {
            window.clearTimeout(pending.computeTimer);
          }
          pending.computeTimer = window.setTimeout(
            () => fail(new SearchError('timeout', 'Search computation timed out')),
            SEARCH_WORKER_TIMEOUT_MS
          );
        };

        pending.startupTimer = window.setTimeout(
          () => fail(new SearchError('timeout', 'Worker startup timed out')),
          SEARCH_WORKER_STARTUP_TIMEOUT_MS
        );
        pendingRequestRef.current = pending;

        worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
          const response = event.data;
          if (!response || response.id !== id) return;
          if (response.started) {
            if (pendingRequestRef.current === pending) armComputeTimeout();
            return;
          }
          if (pendingRequestRef.current !== pending) return;
          pendingRequestRef.current = null;
          clearTimers();
          resolve(response);
        };

        worker.onerror = (event: ErrorEvent) => {
          // Do not poison future searches: a crashed/timed-out worker is
          // replaced on the next request. Keep the browser message for
          // diagnostics (e.g. regex engine OOM vs. timeout).
          fail(
            new SearchError(
              'worker-unavailable',
              'Web Worker failed',
              event.message || 'worker-error'
            )
          );
        };

        try {
          worker.postMessage(build(id));
        } catch (error) {
          fail(
            new SearchError(
              'worker-unavailable',
              'Web Worker failed',
              error instanceof Error ? error.message : String(error)
            )
          );
        }
      });
    },
    [clearPendingRequest, ensureWorker]
  );

  const finishRun = useCallback(
    (
      responseDocs: SearchTabInput[],
      responseOptions: SearchOptions,
      signature: string,
      outcome: SearchOutcome
    ) => {
      setRun({
        outcome,
        docs: responseDocs,
        options: responseOptions,
        signature,
      });
      setIsSearching(false);
      setSearchFailure(null);
      setActiveMatch(0);
      setVisibleCount(RESULT_PAGE_SIZE);
      setPreview(null);
    },
    []
  );

  useEffect(() => {
    if (!isOpen) return;

    const generation = ++generationRef.current;
    setIsPreviewing(false);
    setPreview(null);
    setSearchFailure(null);
    setActiveMatch(0);
    setVisibleCount(RESULT_PAGE_SIZE);

    if (!query) {
      clearPendingRequest(new SearchError('cancelled', 'Search cancelled'));
      setIsSearching(false);
      setRun(null);
      return;
    }

    if (selection.activeUnavailable || docs.length === 0) {
      clearPendingRequest(new SearchError('cancelled', 'Search cancelled'));
      setIsSearching(false);
      setRun(null);
      return;
    }

    try {
      buildSearchPattern(query, options);
    } catch (error) {
      clearPendingRequest(new SearchError('cancelled', 'Search cancelled'));
      setIsSearching(false);
      setRun(null);
      setSearchFailure(toSearchFailure(error));
      return;
    }

    setIsSearching(true);
    const timer = window.setTimeout(() => {
      if (generationRef.current !== generation) return;

      if (!ensureWorker()) {
        if (options.regex) {
          // Without a worker there is no way to interrupt a catastrophic
          // expression, so refuse rather than freeze the UI.
          setIsSearching(false);
          setRun(null);
          setSearchFailure({ code: 'worker-unavailable' });
          return;
        }
        try {
          const outcome = searchDocuments(docs, options);
          if (generationRef.current === generation) {
            finishRun(docs, options, searchSignature, outcome);
          }
        } catch (error) {
          if (generationRef.current === generation) {
            setIsSearching(false);
            setRun(null);
            setSearchFailure(toSearchFailure(error));
          }
        }
        return;
      }

      requestWorker((id) => ({
        kind: 'search',
        id,
        tabs: docs.map((doc) => ({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          kind: doc.kind,
        })),
        options,
        limits: { perTab: PER_TAB_MATCH_LIMIT, total: TOTAL_MATCH_LIMIT },
      }))
        .then((response) => {
          if (generationRef.current !== generation) return;
          if (response.error) {
            setIsSearching(false);
            setRun(null);
            setSearchFailure({
              code: response.error.code,
              detail: response.error.detail ?? response.error.message,
            });
            return;
          }
          if (response.outcome) {
            finishRun(docs, options, searchSignature, response.outcome);
          }
        })
        .catch((error) => {
          if (generationRef.current !== generation) return;
          if (error instanceof SearchError && error.code === 'cancelled') return;
          setIsSearching(false);
          setRun(null);
          setSearchFailure(toSearchFailure(error));
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    isOpen,
    query,
    options,
    docs,
    searchSignature,
    selection.activeUnavailable,
    ensureWorker,
    finishRun,
    requestWorker,
    clearPendingRequest,
  ]);

  // Editing the replacement must invalidate an already-shown preview; the
  // two-phase contract only applies to the exact text that was previewed.
  useEffect(() => {
    setPreview(null);
  }, [replacement]);

  // Keep the inline success message visible across the automatic re-search
  // triggered by applying an edit; only new search inputs clear it.
  useEffect(() => {
    setStatusMessage(null);
  }, [query, caseSensitive, wholeWord, regex, skipCode, scope]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  // Focus management, focus trap and Escape handling follow ResourceManager.
  useEffect(() => {
    if (!isOpen) return;

    skipFocusRestoreRef.current = false;

    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      previouslyFocusedElementRef.current = document.activeElement;
    }

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Escape belongs to this modal only.
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }

      // Other global modals own these shortcuts; close this modal first so they
      // never stack on top of the find/replace dialog. Do not rely on
      // defaultPrevented: the App-level shortcut handler may already have run.
      if (
        event.key === 'F1' ||
        ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === ',')
      ) {
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) return;

      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (
          document.activeElement === firstElement ||
          !modalRef.current.contains(document.activeElement)
        ) {
          event.preventDefault();
          lastElement.focus();
        }
      } else if (
        document.activeElement === lastElement ||
        !modalRef.current.contains(document.activeElement)
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      if (
        !skipFocusRestoreRef.current &&
        previouslyFocusedElementRef.current &&
        typeof previouslyFocusedElementRef.current.focus === 'function'
      ) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (activeMatch >= flatMatches.length) {
      setActiveMatch(flatMatches.length > 0 ? flatMatches.length - 1 : 0);
    }
  }, [activeMatch, flatMatches.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeMatch]);

  const notify = useCallback(
    (message: string, type: ToastType = 'info') => {
      showToast?.(message, type);
    },
    [showToast]
  );

  /**
   * Selecting a result only marks it for "Replace current"; it must not ask the
   * host to reveal the source because a host handler may close the modal. Use
   * double-click or the explicit "Go to source" action to jump and close.
   */
  const activateMatch = useCallback(
    (index: number) => {
      if (!flatMatches[index]) return;
      setActiveMatch(index);
      setVisibleCount((count) =>
        Math.max(
          count,
          Math.ceil((index + 1) / RESULT_PAGE_SIZE) * RESULT_PAGE_SIZE
        )
      );
    },
    [flatMatches]
  );

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      if (flatMatches.length === 0) return;
      const next =
        (activeMatch + direction + flatMatches.length) % flatMatches.length;
      activateMatch(next);
    },
    [activeMatch, activateMatch, flatMatches.length]
  );

  /**
   * Explicit "go to source": root may close the modal right after locating, so
   * skip the modal's focus restoration and let the host focus/scroll the editor.
   * A single row click only selects the match (required by Replace current).
   */
  const locateAndClose = useCallback(
    (match: SearchMatch) => {
      if (workspace) {
        const doc = run?.docs.find((item) => item.id === match.tabId);
        if (!runIsCurrent || isStale || !doc?.filePath || !onLocateWorkspace || locateWorkspaceBusy.current) return;
        locateWorkspaceBusy.current = true;
        skipFocusRestoreRef.current = true;
        void onLocateWorkspace(doc.filePath, match, doc.content).then((opened) => {
          if (!opened) skipFocusRestoreRef.current = false;
        }).catch((error: unknown) => {
          skipFocusRestoreRef.current = false;
          notify(error instanceof Error ? error.message : String(error), 'error');
        }).finally(() => { locateWorkspaceBusy.current = false; });
        return;
      }
      skipFocusRestoreRef.current = true;
      onLocate(match.tabId, match.from, match.to);
      onCloseRef.current();
    },
    [isStale, notify, onLocate, onLocateWorkspace, run, runIsCurrent, workspace]
  );

  const handleLocateActive = useCallback(() => {
    const match = flatMatches[activeMatch];
    if (match) locateAndClose(match);
  }, [activeMatch, flatMatches, locateAndClose]);

  const handlePreview = useCallback(() => {
    if (workspace) return;
    if (!run || isStale || run.signature !== searchSignature) {
      notify(t('search.applyStale'), 'warning');
      setPreview(null);
      return;
    }
    if (run.outcome.totalMatches === 0) {
      notify(t('search.previewNoMatches'), 'info');
      return;
    }
    if (isSearching || isPreviewing) return;

    const generation = generationRef.current;
    const requestSignature = inputSignature;
    const requestRun = run;
    setIsPreviewing(true);

    // Preview text and replacement expansions are computed inside the worker:
    // a hostile regex is never executed again on the UI thread.
    requestWorker((id) => ({
      kind: 'replace',
      id,
      docs: requestRun.docs,
      results: requestRun.outcome.results,
      options: requestRun.options,
      replacement,
      maxPerTab: 2,
    }))
      .then((response) => {
        if (generation !== generationRef.current) return;
        if (requestSignature !== inputSignatureRef.current) return;
        if (response.error) {
          setSearchFailure({
            code: response.error.code,
            detail: response.error.detail ?? response.error.message,
          });
          return;
        }
        if (!response.samples || !response.updates || !response.expansions) {
          return;
        }
        setPreview({
          signature: requestSignature,
          total: requestRun.outcome.totalMatches,
          tabCount: requestRun.outcome.results.filter(
            (result) => result.matches.length > 0
          ).length,
          samples: response.samples,
          truncated: requestRun.outcome.truncated,
          protectedMatches: requestRun.outcome.protectedMatches,
          updates: response.updates,
          expansions: response.expansions,
        });
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        if (error instanceof SearchError && error.code === 'cancelled') return;
        setSearchFailure(toSearchFailure(error));
      })
      .finally(() => {
        if (generation === generationRef.current) setIsPreviewing(false);
      });
  }, [
    inputSignature,
    isPreviewing,
    isSearching,
    isStale,
    notify,
    replacement,
    requestWorker,
    run,
    searchSignature,
    t,
    workspace,
  ]);

  const applyMatches = useCallback(
    (targets: SearchMatch[] | null): boolean => {
      if (!run || isStale || run.signature !== searchSignature) {
        notify(t('search.applyStale'), 'warning');
        setPreview(null);
        return false;
      }
      if (!preview || preview.signature !== inputSignature) {
        notify(t('search.previewRequired'), 'warning');
        return false;
      }
      if (applyLockRef.current) return false;
      if (targets === null && run.outcome.truncated) {
        notify(t('search.truncatedReplaceAll'), 'warning');
        return false;
      }

      const selectedTargets =
        targets ?? run.outcome.results.flatMap((result) => result.matches);
      if (selectedTargets.length === 0) return false;

      const updates: ReplaceUpdate[] = [];
      if (targets === null) {
        for (const update of preview.updates) {
          if (liveContent.get(update.id) !== update.original) {
            notify(t('search.applyConflict'), 'warning');
            setPreview(null);
            setRun(null);
            return false;
          }
          updates.push(update);
        }
      } else {
        for (const match of selectedTargets) {
          const doc = run.docs.find((candidate) => candidate.id === match.tabId);
          if (!doc) return false;
          if (liveContent.get(doc.id) !== doc.content) {
            notify(t('search.applyConflict'), 'warning');
            setPreview(null);
            setRun(null);
            return false;
          }
          const expansion = preview.expansions.find(
            (candidate) =>
              candidate.tabId === match.tabId &&
              candidate.from === match.from &&
              candidate.to === match.to
          );
          if (!expansion) {
            notify(t('search.applyStale'), 'warning');
            setPreview(null);
            return false;
          }
          updates.push({
            id: doc.id,
            original: doc.content,
            content: `${doc.content.slice(0, match.from)}${expansion.text}${doc.content.slice(
              match.to
            )}`,
          });
        }
      }

      if (updates.length === 0) return false;

      applyLockRef.current = true;
      try {
        let success = false;
        try {
          success = onApply(updates);
        } catch (error) {
          notify(
            t('search.applyFailed', {
              error: error instanceof Error ? error.message : String(error),
            }),
            'error'
          );
          return false;
        }

        if (!success) {
          notify(t('search.applyConflict'), 'warning');
          setPreview(null);
          return false;
        }

        setStatusMessage({
          text:
            selectedTargets.length === 1
              ? t('search.appliedCurrent')
              : t('search.appliedAll', { count: selectedTargets.length }),
          tone: 'success',
        });
        setRun(null);
        setPreview(null);
        setActiveMatch(0);
        return true;
      } finally {
        applyLockRef.current = false;
      }
    },
    [
      inputSignature,
      isStale,
      liveContent,
      notify,
      onApply,
      preview,
      run,
      searchSignature,
      t,
    ]
  );

  const handleReplaceCurrent = useCallback(() => {
    if (!previewIsFresh) {
      notify(t('search.previewRequired'), 'warning');
      return;
    }
    const match = flatMatches[activeMatch];
    if (!match) return;
    applyMatches([match]);
  }, [activeMatch, applyMatches, flatMatches, notify, previewIsFresh, t]);

  const handleReplaceAll = useCallback(() => {
    if (!previewIsFresh) {
      notify(t('search.previewRequired'), 'warning');
      return;
    }
    if (!run || run.outcome.truncated) {
      notify(t('search.truncatedReplaceAll'), 'warning');
      return;
    }
    applyMatches(null);
  }, [applyMatches, notify, previewIsFresh, run, t]);

  const visibleGroups = useMemo(() => {
    const groups: {
      tabId: string;
      title: string;
      entries: { match: SearchMatch; index: number }[];
    }[] = [];

    flatMatches.slice(0, visibleCount).forEach((match, index) => {
      const last = groups[groups.length - 1];
      if (!last || last.tabId !== match.tabId) {
        groups.push({
          tabId: match.tabId,
          title: titleById.get(match.tabId) ?? '',
          entries: [{ match, index }],
        });
      } else {
        last.entries.push({ match, index });
      }
    });

    return groups;
  }, [flatMatches, titleById, visibleCount]);

  const countText = run
    ? run.outcome.truncated
      ? t('search.resultCountTruncated', { count: run.outcome.totalMatches })
      : t('search.resultCount', { count: run.outcome.totalMatches })
    : '';

  if (!isOpen) return null;

  const outputLimitLabel = `${Math.round(
    MAX_REPLACEMENT_OUTPUT_LENGTH / (1024 * 1024)
  )} MiB`;
  const errorTitle =
    searchFailure?.code === 'invalid-regex'
      ? t('search.invalidRegex')
      : searchFailure?.code === 'timeout'
      ? t('search.timeout')
      : searchFailure?.code === 'worker-unavailable'
      ? t('search.workerUnavailable')
      : searchFailure?.code === 'output-too-large'
      ? t('search.outputTooLarge')
      : t('search.searchFailed', {
          error: searchFailure?.detail ?? '',
        });
  const errorHint =
    searchFailure?.code === 'invalid-regex'
      ? t('search.invalidRegexDetail', {
          error: searchFailure.detail ?? '',
        })
      : searchFailure?.code === 'timeout'
      ? t('search.timeoutHint')
      : searchFailure?.code === 'worker-unavailable'
      ? t('search.workerUnavailableHint')
      : searchFailure?.code === 'output-too-large'
      ? t('search.outputTooLargeHint', { limit: outputLimitLabel })
      : null;

  const canPreview = Boolean(
    !workspace && run &&
      !isStale &&
      run.signature === searchSignature &&
      run.outcome.totalMatches > 0 &&
      !isSearching &&
      !isPreviewing
  );
  const canApply = Boolean(
    !workspace && previewIsFresh && !isSearching && !isPreviewing && !isStale && run && runIsCurrent
  );
  const canApplyAll = Boolean(
    canApply && run && runIsCurrent && !run.outcome.truncated
  );

  const renderEmptyState = () => {
    if (workspace && !workspaceRoot) {
      return (
        <EmptyState icon={<FileText className="w-9 h-9 opacity-50" />} title={t('search.workspaceChooseHint')} />
      );
    }
    if (workspace && workspaceState?.error) {
      return <EmptyState icon={<AlertTriangle className="w-9 h-9" />} title={t('search.workspaceScanFailed')} hint={workspaceState.error} />;
    }
    if (workspaceLoading) {
      return <EmptyState icon={<LoaderCircle className="w-9 h-9 animate-spin" />} title={t('search.workspaceScanning')} />;
    }
    if (selection.activeUnavailable) {
      return (
        <EmptyState
          icon={<FileText className="w-9 h-9 opacity-50" />}
          title={t('search.scopeUnavailable')}
        />
      );
    }
    if (!query) {
      return (
        <EmptyState
          icon={<Search className="w-9 h-9 opacity-50" />}
          title={t('search.emptyQuery')}
          hint={t('search.emptyQueryHint', { total: TOTAL_MATCH_LIMIT })}
        />
      );
    }
    if (searchFailure) {
      return (
        <EmptyState
          icon={<AlertTriangle className="w-9 h-9 text-amber-500" />}
          title={errorTitle}
          hint={errorHint ?? undefined}
        />
      );
    }
    if (isSearching && !run) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
          <LoaderCircle className="w-8 h-8 mb-2 animate-spin" />
          <p className="text-xs">{t('search.searching')}</p>
        </div>
      );
    }
    if (run && run.outcome.totalMatches === 0) {
      return (
        <EmptyState
          icon={<Search className="w-9 h-9 opacity-50" />}
          title={t('search.noResults')}
          hint={t('search.noResultsHint')}
        />
      );
    }
    return null;
  };

  const emptyState = renderEmptyState();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div
        ref={modalRef}
        className="w-[900px] max-w-[calc(100vw-2rem)] h-[70vh] min-h-[420px] max-h-[calc(100vh-2rem)] bg-elevated rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col text-slate-800 dark:text-slate-100"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-3 border-b border-slate-200 dark:border-slate-700/80 shrink-0">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="flex items-center space-x-2 text-sm font-semibold text-slate-800 dark:text-slate-100"
            >
              <Search className="w-4 h-4 text-blue-500" />
              <span>{t('search.title')}</span>
              {isSearching && (
                <LoaderCircle
                  className="w-3.5 h-3.5 text-blue-500 animate-spin"
                  aria-label={t('search.searching')}
                />
              )}
            </h2>
            <p
              id={descriptionId}
              className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400"
            >
              {t(workspace ? 'search.workspaceDescription' : 'search.description')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('search.close')}
            title={t('search.close')}
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scope + search field */}
        <div className="px-4 pt-2.5 pb-2 border-b border-slate-200 dark:border-slate-700/80 space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label={t('search.scopeLabel')}
              className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md shrink-0"
            >
              {(onLocateWorkspace ? ALL_SCOPES : OPEN_TAB_SCOPES).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    if (item === scope) return;
                    setRun(null);
                    if (item === 'workspace') setWorkspaceRevision((value) => value + 1);
                    setScope(item);
                  }}
                  aria-pressed={scope === item}
                  className={clsx(
                    'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                    scope === item
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  )}
                >
                  {t(item === 'current' ? 'search.scopeCurrent' : item === 'all' ? 'search.scopeAll' : 'search.scopeWorkspace')}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    moveSelection(event.shiftKey ? -1 : 1);
                  }
                }}
                placeholder={t('search.searchPlaceholder')}
                aria-label={t('search.searchInputLabel')}
                spellCheck={false}
                className="w-full pl-7 pr-20 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 text-[11px] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500/60"
              />
              <span
                aria-live="polite"
                className={clsx(
                  'absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums',
                  run && run.outcome.truncated
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-400 dark:text-slate-500'
                )}
              >
                {isSearching ? t('search.searching') : countText}
              </span>
            </div>

            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => moveSelection(-1)}
                disabled={flatMatches.length === 0}
                title={t('search.previous')}
                aria-label={t('search.previous')}
                className="p-1.5 rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveSelection(1)}
                disabled={flatMatches.length === 0}
                title={t('search.next')}
                aria-label={t('search.next')}
                className="p-1.5 rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div
            role="group"
            aria-label={t('search.optionsLabel')}
            className="flex flex-wrap items-center gap-1.5"
          >
            <OptionChip
              active={caseSensitive}
              onClick={() => setCaseSensitive((value) => !value)}
              icon={<CaseSensitive className="w-3.5 h-3.5" />}
              label={t('search.caseSensitiveShort')}
              title={t('search.caseSensitive')}
            />
            <OptionChip
              active={wholeWord}
              onClick={() => setWholeWord((value) => !value)}
              icon={<WholeWord className="w-3.5 h-3.5" />}
              label={t('search.wholeWordShort')}
              title={t('search.wholeWord')}
            />
            <OptionChip
              active={regex}
              onClick={() => setRegex((value) => !value)}
              icon={<Regex className="w-3.5 h-3.5" />}
              label={t('search.regexShort')}
              title={t('search.regex')}
            />
            <OptionChip
              active={skipCode}
              onClick={() => setSkipCode((value) => !value)}
              icon={<Code2 className="w-3.5 h-3.5" />}
              label={t('search.skipCode')}
              title={t('search.skipCodeTooltip')}
            />
            <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 min-w-0">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="truncate">{t('search.protectHint')}</span>
            </span>
            {run && run.outcome.protectedMatches > 0 && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                {t('search.protectedSkipped', {
                  count: run.outcome.protectedMatches,
                })}
              </span>
            )}
          </div>
        </div>

        {workspace ? (
          <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700/80 flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate" title={workspaceRoot ?? undefined}>
              {workspaceRoot ?? t('search.workspaceChooseHint')}
            </span>
            {workspaceRoot && (
              <button
                type="button"
                onClick={() => { setRun(null); setWorkspaceRevision((value) => value + 1); }}
                disabled={workspaceLoading}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-panel disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t('search.workspaceRefresh')}
              </button>
            )}
            {onChooseWorkspace && (
              <button type="button" onClick={() => void onChooseWorkspace()} className="rounded px-2 py-1 hover:bg-panel">
                {t('search.workspaceChoose')}
              </button>
            )}
          </div>
        ) : (
          <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative flex-1 min-w-[220px]">
              <Replace className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handlePreview();
                  }
                }}
                placeholder={t('search.replacePlaceholder')}
                aria-label={t('search.replaceInputLabel')}
                spellCheck={false}
                className="w-full pl-7 pr-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 text-[11px] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500/60"
              />
            </div>

            <button
              type="button"
              onClick={handlePreview}
              disabled={!canPreview}
              title={
                canPreview
                  ? t('search.previewReplace')
                  : previewIsFresh
                  ? t('search.previewTitle')
                  : t('search.previewRequired')
              }
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-[11px] font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {isPreviewing ? (
                <LoaderCircle className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-indigo-500" />
              )}
              <span>{t('search.previewReplace')}</span>
            </button>

            <button
              type="button"
              onClick={handleReplaceCurrent}
              disabled={!canApply || flatMatches.length === 0}
              title={
                canApply
                  ? t('search.replaceCurrentTooltip')
                  : t('search.previewRequired')
              }
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Replace className="w-3.5 h-3.5" />
              <span>{t('search.applyCurrent')}</span>
            </button>

            <button
              type="button"
              onClick={handleReplaceAll}
              disabled={!canApplyAll}
              title={
                run?.outcome.truncated
                  ? t('search.truncatedReplaceAll')
                  : canApplyAll
                  ? t('search.replaceAllTooltip')
                  : t('search.previewRequired')
              }
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <ReplaceAll className="w-3.5 h-3.5" />
              <span>{t('search.applyAll')}</span>
            </button>
          </div>
        )}

        {/* Alerts */}
        {searchFailure && (
          <div
            role="alert"
            className="mx-4 mt-2 px-3 py-2 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-[11px] text-red-600 dark:text-red-400 shrink-0"
          >
            <p className="font-medium flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {errorTitle}
            </p>
            {errorHint && <p className="mt-0.5 pl-5">{errorHint}</p>}
            {searchFailure?.detail && searchFailure.code !== 'invalid-regex' && (
              <p className="mt-0.5 pl-5 font-mono text-[10px] break-all opacity-80">
                {searchFailure.detail}
              </p>
            )}
          </div>
        )}

        {isStale && (
          <div
            role="status"
            className="mx-4 mt-2 px-3 py-1.5 rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-700 dark:text-amber-400 shrink-0"
          >
            {t('search.staleBanner')}
          </div>
        )}

        {run?.outcome.truncated && (
          <div
            role="alert"
            className="mx-4 mt-2 px-3 py-1.5 rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-700 dark:text-amber-400 shrink-0"
          >
            <p>
              {t('search.truncatedBanner', {
                perTab: PER_TAB_MATCH_LIMIT,
                total: TOTAL_MATCH_LIMIT,
              })}
            </p>
            {!workspace && <p className="mt-0.5">{t('search.truncatedReplaceAll')}</p>}
          </div>
        )}

        {workspace && workspaceSnapshot && (workspaceSnapshot.skipped > 0 || workspaceSnapshot.truncated) && (
          <p role="status" className="mx-4 mt-2 rounded px-2 py-1 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-700 dark:text-amber-300">
            {t('search.workspacePartial', { count: workspaceSnapshot.skipped })}
          </p>
        )}

        {statusMessage && (
          <div
            role="status"
            aria-live="polite"
            className={clsx(
              'mx-4 mt-2 px-3 py-1.5 rounded border text-[11px] shrink-0',
              statusMessage.tone === 'success'
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
            )}
          >
            {statusMessage.text}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          <aside className="w-[220px] shrink-0 border-r border-slate-200 dark:border-slate-700/80 flex flex-col min-h-0">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 shrink-0">
              {t('search.documentsLabel')}
            </div>
            <ul
              aria-label={t('search.documentsLabel')}
              className="flex-1 overflow-y-auto px-2 pb-2 space-y-1"
            >
              {docResults.length === 0 ? (
                <li className="px-2 py-6 text-center text-[10px] text-slate-400 dark:text-slate-500">
                  {query ? t('search.noResults') : t('search.emptyQuery')}
                </li>
              ) : (
                docResults.map((result) => {
                  const isActive =
                    flatMatches[activeMatch]?.tabId === result.tabId;
                  return (
                    <li key={result.tabId}>
                      <button
                        type="button"
                        onClick={() => {
                          const index = firstMatchIndexByTab.get(result.tabId);
                          if (index !== undefined) activateMatch(index);
                        }}
                        aria-current={isActive ? 'true' : undefined}
                        title={result.title}
                        className={clsx(
                          'w-full text-left px-2 py-1.5 rounded border transition-colors',
                          isActive
                            ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
                            : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70'
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">
                            {result.title}
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                            {t('search.matchCount', {
                              count: result.matches.length,
                            })}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-2">
              {emptyState ?? (
                <div className="space-y-2">
                  {visibleGroups.map((group) => (
                    <div key={group.tabId}>
                      <div className="sticky top-0 z-10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 bg-elevated/95 backdrop-blur-xs flex items-center gap-1.5">
                        <FileText className="w-3 h-3" />
                        <span className="truncate">{group.title}</span>
                        <span className="font-normal normal-case">
                          ·{' '}
                          {t('search.matchCount', {
                            count:
                              run?.outcome.results.find(
                                (result) => result.tabId === group.tabId
                              )?.matches.length ?? group.entries.length,
                          })}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {group.entries.map(({ match, index }) => {
                          const content = runContentById.get(match.tabId) ?? '';
                          const snippet = formatSearchSnippet(
                            content,
                            match.from,
                            match.to
                          );
                          const isActive = index === activeMatch;
                          return (
                            <button
                              key={`${match.tabId}-${match.from}-${index}`}
                              ref={isActive ? activeRowRef : null}
                              type="button"
                              onClick={() => workspace ? locateAndClose(match) : activateMatch(index)}
                              onDoubleClick={workspace ? undefined : () => locateAndClose(match)}
                              aria-current={isActive ? 'true' : undefined}
                              title={`${t('search.matchAt', {
                                line: match.line,
                                column: match.column,
                              })} · ${t(workspace ? 'search.workspaceLocateHint' : 'search.locateHint')}`}
                              className={clsx(
                                'w-full text-left px-2 py-1 rounded border transition-colors flex items-start gap-2',
                                isActive
                                  ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
                                  : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70'
                              )}
                            >
                              <span className="shrink-0 mt-0.5 px-1.5 py-0 rounded bg-slate-100 dark:bg-slate-800 text-[9px] tabular-nums text-slate-500 dark:text-slate-400">
                                {t('search.lineLabel', { line: match.line })}
                              </span>
                              <span className="min-w-0 flex-1 font-mono text-[10px] leading-relaxed text-slate-500 dark:text-slate-400 break-all">
                                {snippet.before}
                                <mark className="bg-amber-200 dark:bg-amber-500/30 text-slate-900 dark:text-amber-100 rounded px-0.5">
                                  {snippet.match}
                                </mark>
                                {snippet.after}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {flatMatches.length > visibleCount && (
                    <div className="pt-1 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleCount((count) => count + RESULT_PAGE_SIZE)
                        }
                        className="px-2.5 py-1 rounded text-[10px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700/60"
                      >
                        {t('search.showMore', {
                          count: flatMatches.length - visibleCount,
                        })}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {!workspace && preview && (
              <div className="shrink-0 max-h-[190px] overflow-y-auto border-t border-slate-200 dark:border-slate-700/80 bg-panel/40 px-4 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200">
                    <Eye className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{t('search.previewTitle')}</span>
                    <span className="font-normal text-slate-500 dark:text-slate-400">
                      ·{' '}
                      {t('search.previewSummary', {
                        count: preview.total,
                        tabs: preview.tabCount,
                      })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    aria-label={t('common.close')}
                    title={t('common.close')}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {preview.truncated && (
                  <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                    {t('search.previewTruncated')}
                  </p>
                )}
                <ul className="mt-1.5 space-y-1">
                  {preview.samples.map((sample, index) => (
                    <li
                      key={`${sample.tabId}-${sample.line}-${index}`}
                      className="rounded border border-slate-200 dark:border-slate-700/70 px-2 py-1"
                    >
                      <div className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
                        {sample.title} ·{' '}
                        {t('search.lineLabel', { line: sample.line })}
                      </div>
                      <div className="grid grid-cols-2 gap-2 font-mono text-[10px] leading-relaxed">
                        <div className="min-w-0">
                          <span className="block text-[9px] font-sans text-slate-400 dark:text-slate-500">
                            {t('search.previewBefore')}
                          </span>
                          <span className="block break-all text-slate-600 dark:text-slate-300">
                            {sample.before}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[9px] font-sans text-emerald-600 dark:text-emerald-400">
                            {t('search.previewAfter')}
                          </span>
                          <span className="block break-all text-emerald-700 dark:text-emerald-300">
                            {sample.after}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {preview.samples.length > 0 && preview.total > preview.samples.length && (
                  <p className="mt-1 text-[9px] text-slate-400 dark:text-slate-500">
                    {t('search.previewSampleMore', {
                      shown: preview.samples.length,
                      count: preview.total,
                    })}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-1.5 border-t border-slate-200 dark:border-slate-700/80 text-[10px] text-slate-400 dark:text-slate-500 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span>
            {t('search.limitsHint', {
              perTab: PER_TAB_MATCH_LIMIT,
              total: TOTAL_MATCH_LIMIT,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLocateActive}
              disabled={flatMatches.length === 0}
              title={t('search.locateHint')}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <MapPin className="w-3 h-3 text-blue-500" />
              <span>{t('search.locateSource')}</span>
            </button>
            <span>
              {t('search.closeHint')} · {t('search.locateHint')} ·{' '}
              {t('search.noAutoSaveHint')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const OptionChip: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}> = ({ active, onClick, icon, label, title }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    title={title}
    className={clsx(
      'flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors',
      active
        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300'
        : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'
    )}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint?: string;
}> = ({ icon, title, hint }) => (
  <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-slate-400 dark:text-slate-500">
    {icon}
    <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
      {title}
    </p>
    {hint && <p className="mt-1 text-[10px] max-w-[320px]">{hint}</p>}
  </div>
);

export default DocumentSearch;
