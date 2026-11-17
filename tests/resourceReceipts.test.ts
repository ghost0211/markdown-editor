import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { settleCreatedResourceFiles, writeResourceFile } from '../src/lib/native';

const BYTES = new Uint8Array([1, 2, 3, 4]);

function enterTauri(): void {
  (globalThis as unknown as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
}

function readFrame(frame: Uint8Array): { path: string; payload: Uint8Array } {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const length = view.getUint32(0, true);
  return {
    path: new TextDecoder().decode(frame.subarray(4, 4 + length)),
    payload: frame.subarray(4 + length),
  };
}

beforeEach(() => {
  invoke.mockReset();
  enterTauri();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('resource file receipt bridge', () => {
  it('returns the native receipt for create-without-overwrite writes', async () => {
    invoke.mockResolvedValue('receipt-abc');
    const receipt = await writeResourceFile('C:/docs/assets/pic.png', BYTES, true);

    expect(receipt).toBe('receipt-abc');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe('create_resource_file');
    const frame = readFrame(invoke.mock.calls[0][1] as Uint8Array);
    expect(frame.path).toBe('C:/docs/assets/pic.png');
    expect(frame.payload).toEqual(BYTES);
  });

  it('treats overwrite exports as void and normalizes non-string receipts to null', async () => {
    invoke.mockResolvedValue(undefined);
    await expect(writeResourceFile('C:/out/pic.png', BYTES)).resolves.toBeNull();
    expect(invoke.mock.calls[0][0]).toBe('export_resource_file');

    invoke.mockResolvedValue(42);
    await expect(writeResourceFile('C:/out/pic.png', BYTES, true)).resolves.toBeNull();
  });

  it('wraps native write failures as Error with the original cause', async () => {
    invoke.mockRejectedValue('access denied');
    await expect(writeResourceFile('C:/docs/pic.png', BYTES, true)).rejects.toThrow('access denied');
  });

  it('settles receipts with an explicit commit/discard flag', async () => {
    invoke.mockResolvedValue(undefined);
    await settleCreatedResourceFiles(['receipt-1', 'receipt-2'], false);
    expect(invoke).toHaveBeenCalledWith('settle_created_resource_files', {
      receipts: ['receipt-1', 'receipt-2'],
      discard: false,
    });

    invoke.mockClear();
    await settleCreatedResourceFiles(['receipt-3'], true);
    expect(invoke).toHaveBeenCalledWith('settle_created_resource_files', {
      receipts: ['receipt-3'],
      discard: true,
    });

    // Empty receipt lists are a no-op and never hit the native layer.
    invoke.mockClear();
    await settleCreatedResourceFiles([], true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does nothing in the browser build', async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    await settleCreatedResourceFiles(['receipt-browser'], true);
    expect(invoke).not.toHaveBeenCalled();
    await expect(writeResourceFile('browser://pic.png', BYTES, true)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
