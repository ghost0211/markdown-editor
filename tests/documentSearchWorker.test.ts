import { afterEach, describe, expect, it, vi } from 'vitest';

interface WorkerMessage {
  id: number;
  started?: boolean;
  outcome?: { totalMatches: number; results: unknown[] };
  updates?: { id: string; original: string; content: string }[];
  expansions?: { tabId: string; from: number; to: number; text: string }[];
  samples?: unknown[];
  error?: unknown;
}

/**
 * Executes the real worker module in Node by standing in for the worker global
 * scope. This catches protocol drift between the component and the worker
 * (started handshake, request kinds, response fields) without a browser.
 */
describe('document search worker protocol', () => {
  const globalScope = globalThis as unknown as {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage?: (message: WorkerMessage) => void;
  };
  const originalOnMessage = globalScope.onmessage;
  const originalPostMessage = globalScope.postMessage;

  const dispatch = (data: unknown) => {
    const handler = (
      globalThis as unknown as {
        onmessage: ((event: { data: unknown }) => void) | null;
      }
    ).onmessage;
    handler?.({ data });
  };

  afterEach(() => {
    globalScope.onmessage = originalOnMessage;
    globalScope.postMessage = originalPostMessage;
  });

  it('answers a search request with started + outcome', async () => {
    const messages: WorkerMessage[] = [];
    globalScope.postMessage = (message: WorkerMessage) => messages.push(message);
    globalScope.onmessage = null;
    vi.resetModules();

    await import('../src/workers/documentSearch.worker');

    expect(typeof globalScope.onmessage).toBe('function');
    dispatch({
      kind: 'search',
      id: 7,
      tabs: [
        { id: 'a', title: 'A', content: 'Alpha alpha', kind: 'document' },
      ],
      options: {
        query: 'Alpha',
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      },
    });

    expect(messages[0]).toEqual({ id: 7, started: true });
    expect(messages[1].id).toBe(7);
    expect(messages[1].outcome?.totalMatches).toBe(2);
    expect(messages[1].error).toBeUndefined();
  });

  it('prepares preview samples and buffers in the worker for a replace request', async () => {
    const messages: WorkerMessage[] = [];
    globalScope.postMessage = (message: WorkerMessage) => messages.push(message);
    globalScope.onmessage = null;
    vi.resetModules();

    await import('../src/workers/documentSearch.worker');

    dispatch({
      kind: 'search',
      id: 1,
      tabs: [{ id: 'a', title: 'A', content: 'cat cat', kind: 'document' }],
      options: {
        query: 'cat',
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      },
    });
    const outcome = messages[1].outcome as { results: unknown[] };

    dispatch({
      kind: 'replace',
      id: 2,
      docs: [{ id: 'a', title: 'A', content: 'cat cat', kind: 'document' }],
      results: outcome.results,
      options: {
        query: 'cat',
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      },
      replacement: 'dog',
      maxPerTab: 2,
    });

    expect(messages[2]).toEqual({ id: 2, started: true });
    expect(messages[3].updates?.[0]).toEqual({
      id: 'a',
      original: 'cat cat',
      content: 'dog dog',
    });
    expect(messages[3].expansions).toHaveLength(2);
    expect(messages[3].samples).toHaveLength(2);
  });
});
