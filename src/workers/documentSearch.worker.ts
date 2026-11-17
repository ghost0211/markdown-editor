/**
 * Dedicated worker that runs the enhanced search engine off the UI thread.
 *
 * Search, replacement preview and replacement preparation all happen here, so
 * a hostile regular expression is never re-executed on the UI thread after the
 * initial search. The component enforces a hard computation timeout and
 * terminates this worker when an expression takes too long.
 *
 * Every request carries its own snapshots/options and the response echoes the
 * request id, letting the UI discard results that are no longer current. A
 * `started` message is posted before computation begins so cold module loading
 * is excluded from the expensive-operation timeout.
 */
import {
  SearchError,
  buildReplacePreviewSamples,
  prepareReplacements,
  searchDocuments,
  type SearchWorkerRequest,
  type SearchWorkerResponse,
} from '@/lib/documentSearch';

interface WorkerGlobal {
  onmessage: ((event: MessageEvent<SearchWorkerRequest>) => void) | null;
  postMessage: (message: SearchWorkerResponse) => void;
}

const workerScope = globalThis as unknown as WorkerGlobal;

function serializeError(error: unknown) {
  if (error instanceof SearchError) {
    return { code: error.code, message: error.message, detail: error.detail };
  }
  return {
    code: 'internal' as const,
    message: error instanceof Error ? error.message : String(error),
  };
}

workerScope.onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const request = event.data;
  workerScope.postMessage({ id: request.id, started: true });

  try {
    if (request.kind === 'replace') {
      const prepared = prepareReplacements(
        request.docs,
        request.results,
        request.options,
        request.replacement
      );
      const samples = buildReplacePreviewSamples(
        request.docs,
        request.results,
        request.options,
        request.replacement,
        request.maxPerTab ?? 2,
        prepared.expansions
      );
      workerScope.postMessage({
        id: request.id,
        updates: prepared.updates,
        expansions: prepared.expansions,
        samples,
      });
      return;
    }

    const outcome = searchDocuments(request.tabs, request.options, request.limits);
    workerScope.postMessage({ id: request.id, outcome });
  } catch (error) {
    workerScope.postMessage({ id: request.id, error: serializeError(error) });
  }
};

export {};
