import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { OpenFileResult } from '@/types';
import { t, getCurrentLanguage } from '@/i18n';
import { ensureExportPathExtension } from '@/lib/documentUtils';

export const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** MIME type of an .xmd bundle (Markdown document + zipped image resources). */
export const XMD_MIME_TYPE = 'application/vnd.xmd+zip';

export type ExportFormat = 'docx' | 'pdf' | 'html' | 'svg' | 'png' | 'xmd';

/**
 * Opens Windows Default Apps settings page (ms-settings:defaultapps).
 * Dedicated fixed command that does not accept arbitrary schemes.
 * Gracefully returns/throws friendly error on non-Windows / Web environment.
 */
export async function openWindowsDefaultAppsSettings(): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('open_windows_default_apps_settings');
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '打开 Windows 设置失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotOpenSettings'));
  }
}

/**
 * Checks if the current environment is running inside Tauri.
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

/**
 * Validates that a given URL string uses only safe protocols (http, https, mailto).
 * Rejects javascript:, data:, file:, vbscript:, and other potentially dangerous schemes.
 */
export function isValidExternalUrl(urlStr?: string | null): boolean {
  if (!urlStr || typeof urlStr !== 'string') {
    return false;
  }
  const trimmed = urlStr.trim();
  if (!trimmed) {
    return false;
  }

  // Reject ASCII control characters
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Drains pending file paths from native backend (e.g. from cold start CLI args).
 * Gracefully returns an empty array in Web mode or on error.
 */
export async function drainPendingOpenFiles(): Promise<string[]> {
  if (isTauri()) {
    try {
      const paths = await invoke<string[]>('drain_pending_open_files');
      return Array.isArray(paths) ? paths : [];
    } catch (err: unknown) {
      console.warn('获取待打开文件列表失败:', err);
      return [];
    }
  }
  return [];
}

/**
 * Subscribes to the single-instance 'open-files' event emitted when a file or secondary instance launches.
 * The event acts as a wake-up signal for the frontend to atomically drain the backend pending file queue.
 * Gracefully returns a no-op cleanup function in Web mode.
 */
export async function subscribeOpenFiles(
  callback: () => void
): Promise<() => void> {
  if (isTauri()) {
    try {
      const unlisten: UnlistenFn = await listen('open-files', () => {
        callback();
      });
      return unlisten;
    } catch (err: unknown) {
      console.warn('订阅 open-files 事件失败:', err);
      return () => {};
    }
  }
  return () => {};
}

/**
 * Reads UTF-8 file content given a full path.
 */
export async function readTextFile(path: string): Promise<string> {
  if (isTauri()) {
    try {
      if (path.toLowerCase().endsWith('.xmd')) {
        const raw = await invoke<ArrayBuffer>('read_xmd_document', { path });
        const { importXmd } = await import('@/lib/xmd');
        return await importXmd(new Uint8Array(raw));
      }
      return await invoke<string>('read_text_file', { path });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '读取文件失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotReadByPath'));
  }
}

/**
 * Reads binary file content for local preview media. Kept separate from text
 * reads so images are never decoded as UTF-8 or exposed through a broad asset
 * protocol scope.
 */
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  if (!isTauri()) {
    throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotReadByPath'));
  }
  try {
    const bytes = await invoke<number[]>('read_binary_file', { path });
    return new Uint8Array(bytes);
  } catch (err: unknown) {
    const msg = typeof err === 'string' ? err : (err as Error)?.message || '读取二进制文件失败';
    throw new Error(msg, { cause: err });
  }
}

/**
 * Fetches a remote image for an .xmd bundle.
 *
 * In Tauri the request is proxied through the Rust `fetch_xmd_image` command,
 * because the desktop webview CSP forbids cross-origin browser fetches. The Web
 * fallback is a plain no-credentials fetch used by the browser build.
 */
export async function fetchXmdImage(
  url: string
): Promise<{ data: Uint8Array; contentType: string }> {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) {
    throw new Error('网络图片地址为空');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`无效的网络图片地址: ${trimmed}`);
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`不支持的网络图片协议: ${parsed.protocol}`);
  }

  if (isTauri()) {
    try {
      const res = await invoke<{
        data: number[];
        contentType?: string;
        content_type?: string;
      }>('fetch_xmd_image', { url: trimmed });
      if (!res || !Array.isArray(res.data)) {
        throw new Error('网络图片数据格式错误');
      }
      return {
        data: new Uint8Array(res.data),
        contentType: res.contentType || res.content_type || '',
      };
    } catch (err: unknown) {
      const msg =
        typeof err === 'string' ? err : (err as Error)?.message || '获取网络图片失败';
      throw new Error(msg, { cause: err });
    }
  }

  if (typeof fetch !== 'function') {
    throw new Error('当前环境不支持获取网络图片');
  }

  try {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(30000)
        : undefined;
    const response = await fetch(trimmed, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || '',
    };
  } catch (err: unknown) {
    const msg =
      typeof err === 'string' ? err : (err as Error)?.message || '获取网络图片失败';
    throw new Error(msg, { cause: err });
  }
}

/**
 * Reads an XMD resource (image/attachment) as raw bytes through the native
 * command. The Rust side pre-checks the 32 MiB limit *before* reading, so a
 * huge local file is never loaded speculatively, and only explicit local paths
 * are accepted. Web builds cannot read by path and fail fast.
 */
export async function readXmdResource(path: string): Promise<Uint8Array> {
  if (!isTauri()) {
    throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotReadByPath'));
  }
  try {
    const raw = await invoke<ArrayBuffer>('read_xmd_resource', { path });
    return new Uint8Array(raw);
  } catch (err: unknown) {
    const msg = typeof err === 'string' ? err : (err as Error)?.message || '读取资源文件失败';
    throw new Error(msg, { cause: err });
  }
}

/**
 * Returns the file's last-modified time in milliseconds since the Unix epoch.
 * Returns null in Web mode or on error (e.g. file deleted), allowing callers
 * to treat it as "unknown" without throwing.
 */
export async function getFileMtime(path: string): Promise<number | null> {
  if (isTauri()) {
    try {
      const mtime = await invoke<number>('get_file_mtime', { path });
      return typeof mtime === 'number' && Number.isFinite(mtime) ? mtime : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Reads the actual size of a referenced local file for the resource manager. */
export async function getFileSize(path: string): Promise<number> {
  if (!isTauri()) throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotReadByPath'));
  try {
    const size = await invoke<number>('get_file_size', { path });
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) throw new Error('Invalid file size');
    return size;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message, { cause: error });
  }
}

/**
 * Writes UTF-8 content to a file.
 */
export async function writeTextFile(path: string, content: string, sourceFilePath?: string | null): Promise<void> {
  if (path.toLowerCase().endsWith('.xmd')) {
    const { exportMarkdownToXmd } = await import('@/lib/export/xmdExporter');
    const title = path.replace(/\\/g, '/').split('/').pop() || 'document.xmd';
    // Save As must resolve relative resources against the source document, not
    // the new destination directory. Existing XMD saves pass the same path.
    const bytes = await exportMarkdownToXmd(content, title, { sourceFilePath: sourceFilePath || path });
    await writeBinaryFile(path, bytes);
    return;
  }
  if (isTauri()) {
    try {
      await invoke('write_text_file', { path, content });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '保存文件失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    // Web fallback: Trigger browser file download with appropriate MIME
    const lower = path.toLowerCase();
    const mimeType = lower.endsWith('.html') || lower.endsWith('.htm')
      ? 'text/html;charset=utf-8'
      : lower.endsWith('.svg')
      ? 'image/svg+xml;charset=utf-8'
      : 'text/markdown;charset=utf-8';
    downloadBlob(content, path || 'document.md', mimeType);
  }
}

/**
 * Writes HTML document content to a file with UTF-8 encoding and text/html MIME type in browser fallback.
 */
export async function writeHtmlFile(path: string, content: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('write_text_file', { path, content });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '保存 HTML 文件失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    downloadBlob(content, path || 'document.html', 'text/html;charset=utf-8');
  }
}

/** Size of the little-endian u32 path-length header in the `write_xmd_file` frame. */
const XMD_WRITE_FRAME_HEADER_BYTES = 4;

/**
 * Builds the raw binary frame accepted by the native `write_xmd_file` command:
 * 4-byte little-endian u32 path byte length, the UTF-8 path, then the ZIP bytes.
 * Sending one raw IPC body keeps the ZIP out of JSON serialization.
 */
function buildXmdWriteFrame(path: string, data: Uint8Array): Uint8Array {
  const pathBytes = new TextEncoder().encode(path);
  const frame = new Uint8Array(
    XMD_WRITE_FRAME_HEADER_BYTES + pathBytes.length + data.length
  );
  new DataView(frame.buffer).setUint32(0, pathBytes.length, true);
  frame.set(pathBytes, XMD_WRITE_FRAME_HEADER_BYTES);
  frame.set(data, XMD_WRITE_FRAME_HEADER_BYTES + pathBytes.length);
  return frame;
}

/**
 * Resource-manager writes use raw bytes and never reinterpret a `.xmd` filename.
 *
 * A `createNew` write (used while externalizing an embedded image) returns the
 * native receipt token that identifies the exact file this call created. The
 * resource manager keeps it until the Markdown update has been committed and
 * then calls {@link settleCreatedResourceFiles}; plain exports return `null`.
 */
export async function writeResourceFile(path: string, data: Uint8Array, createNew = false): Promise<string | null> {
  if (data.length > 32 * 1024 * 1024) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
  if (isTauri()) {
    try {
      const receipt = await invoke<string | null>(
        createNew ? 'create_resource_file' : 'export_resource_file',
        buildXmdWriteFrame(path, data)
      );
      return typeof receipt === 'string' && receipt.length > 0 ? receipt : null;
    } catch (error) {
      throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : String(error), { cause: error });
    }
  }
  if (createNew) throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotReadByPath'));
  // Attachments are downloads, never executable document navigation.
  downloadBlob(new Uint8Array(data), path, 'application/octet-stream');
  return null;
}

/**
 * Releases or rolls back files created through `writeResourceFile(..., true)`.
 *
 * - `discard: false` commits the conversion and only drops the native receipt
 *   records, so the created assets stay on disk.
 * - `discard: true` removes the files that *this* operation created, but only
 *   when they are still byte-for-byte unchanged; user edits are never deleted.
 *
 * Browser builds have nothing to settle; the call is a no-op there.
 */
export async function settleCreatedResourceFiles(receipts: string[], discard: boolean): Promise<void> {
  if (!Array.isArray(receipts) || receipts.length === 0) return;
  if (!isTauri()) return;
  try {
    await invoke('settle_created_resource_files', { receipts, discard });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : String(error), { cause: error });
  }
}

/**
 * Writes binary content (e.g. .docx buffer) to a file.
 *
 * `.xmd` bundles on desktop go through the dedicated raw `write_xmd_file`
 * command (length-prefixed path + ZIP bytes) so large archives never pass
 * through JSON arrays; every other format keeps the existing behavior.
 */
export async function writeBinaryFile(path: string, data: Uint8Array | number[]): Promise<void> {
  if (isTauri()) {
    try {
      if (path.toLowerCase().endsWith('.xmd')) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        await invoke('write_xmd_file', buildXmdWriteFrame(path, bytes));
        return;
      }
      const payload = data instanceof Uint8Array ? Array.from(data) : data;
      await invoke('write_binary_file', { path, data: payload });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '保存二进制文件失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    // Web fallback: Trigger browser file download with appropriate mime
    const lower = path.toLowerCase();
    const mimeType = lower.endsWith('.xmd')
      ? XMD_MIME_TYPE
      : lower.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : lower.endsWith('.pdf')
      ? 'application/pdf'
      : lower.endsWith('.png')
      ? 'image/png'
      : 'application/octet-stream';
    downloadBlob(data, path || 'document.bin', mimeType);
  }
}

/**
 * Opens native file dialog to select a Markdown/text file.
 */
export async function openFileDialog(): Promise<OpenFileResult | null> {
  if (isTauri()) {
    try {
      const res = await invoke<OpenFileResult | null>('open_file_dialog');
      return res;
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '打开文件对话框失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    // Browser fallback
    if (typeof document === 'undefined') {
      return null;
    }

    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.mdown,.mkd,.txt,.xmd';
      input.style.display = 'none';

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        try {
          const text = file.name.toLowerCase().endsWith('.xmd')
            ? await (await import('@/lib/xmd')).importXmd(new Uint8Array(await file.arrayBuffer()))
            : await file.text();
          resolve({
            path: `browser://${file.name}`,
            name: file.name,
            content: text,
          });
        } catch (e) {
          reject(
            new Error(
              t(getCurrentLanguage(), 'browserFallback.cannotReadFile', {
                error: (e as Error).message,
              })
            )
          );
        } finally {
          document.body.removeChild(input);
        }
      };

      input.oncancel = () => {
        resolve(null);
        document.body.removeChild(input);
      };

      document.body.appendChild(input);
      input.click();
    });
  }
}

/** Save a resource with its original extension instead of forcing `.md`. */
export async function saveResourceDialog(defaultName: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string | null>('save_resource_dialog', { defaultName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message, { cause: error });
    }
  }
  if (typeof window === 'undefined') return null;
  const name = window.prompt(t(getCurrentLanguage(), 'browserFallback.promptSaveFilename'), defaultName);
  return name ? `browser://${name}` : null;
}

/**
 * Opens native save file dialog to select a destination path.
 */
export async function saveFileDialog(defaultName?: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string | null>('save_file_dialog', { defaultName });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '保存对话框失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    // Browser fallback: prompts user for filename
    if (typeof window === 'undefined') return null;
    const lang = getCurrentLanguage();
    const fallbackDefault = defaultName || t(lang, 'common.untitledDoc');
    const name = window.prompt(t(lang, 'browserFallback.promptSaveFilename'), fallbackDefault);
    if (!name) return null;
    return `browser://${name.endsWith('.md') ? name : `${name}.md`}`;
  }
}

/**
 * Opens native export file dialog to select a destination path for docx/pdf/html.
 */
export async function exportFileDialog(
  format: ExportFormat,
  defaultName?: string
): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string | null>('export_file_dialog', {
        format,
        defaultName,
      });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '导出对话框打开失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    // Browser fallback: prompts user for filename
    if (typeof window === 'undefined') return null;
    const lang = getCurrentLanguage();
    const base = (defaultName || t(lang, 'common.untitled')).replace(
      /\.(md|markdown|mdown|mkd|txt|docx|pdf|html|htm|svg|png|xmd)$/i,
      ''
    );
    const promptName = `${base}.${format}`;
    const name = window.prompt(
      t(lang, 'browserFallback.promptExportFilename', { format: format.toUpperCase() }),
      promptName
    );
    if (!name) return null;
    if (format === 'xmd') {
      // An XMD bundle must always land on `.xmd`; a typed source extension
      // (e.g. `notes.md`) is replaced rather than producing `notes.md.xmd`,
      // which also guarantees the Markdown source is never overwritten.
      const cleanName = name.replace(/\.(md|markdown|mdown|mkd|txt|docx|pdf|html|htm)$/i, '');
      return `browser://${ensureExportPathExtension(cleanName, 'xmd')}`;
    }
    const finalName = name.toLowerCase().endsWith(`.${format}`) ? name : `${name}.${format}`;
    return `browser://${finalName}`;
  }
}

/**
 * Converts HTML to PDF via headless Edge (in Tauri) or browser print dialog (in Web mode).
 *
 * `showHeaderFooter` defaults to false so old callers keep Edge's
 * `--no-pdf-header-footer` behavior. Passing true lets Edge draw its native
 * page header/footer (including page numbers) for the PDF.
 */
export async function exportPdfFromHtml(
  path: string,
  html: string,
  showHeaderFooter = false
): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('export_pdf_from_html', { path, html, showHeaderFooter });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || 'PDF 导出失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    // Browser print fallback
    const lang = getCurrentLanguage();
    if (typeof window === 'undefined') {
      throw new Error(t(lang, 'browserFallback.webCannotPrint'));
    }
    const printWin = window.open('', '_blank');
    if (printWin) {
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
      printWin.focus();
      setTimeout(() => {
        printWin.print();
      }, 250);
    } else {
      throw new Error(t(lang, 'browserFallback.webPrintPopupBlocked'));
    }
  }
}

/**
 * Safely open external link in default browser / system handler.
 * Validates protocol against whitelist before attempting to open.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!isValidExternalUrl(trimmed)) {
    throw new Error(
      t(getCurrentLanguage(), 'browserFallback.unsupportedUrlProtocol', { url })
    );
  }

  if (isTauri()) {
    try {
      await invoke('open_url', { url: trimmed });
    } catch {
      // Fallback only for verified safe URLs
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(trimmed, '_blank', 'noopener,noreferrer');
      }
    }
  } else {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(trimmed, '_blank', 'noopener,noreferrer');
    }
  }
}

/**
 * Opens the file's containing folder in the system file manager and selects/highlights the file.
 * Returns a friendly error or falls back gracefully in Web mode.
 */
export async function showInFolder(path: string): Promise<void> {
  const trimmed = typeof path === 'string' ? path.trim() : '';
  if (!trimmed || trimmed.startsWith('browser://')) {
    throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotShowInFolder'));
  }

  if (isTauri()) {
    try {
      await invoke('show_in_folder', { path: trimmed });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '打开文件位置失败';
      throw new Error(msg, { cause: err });
    }
  } else {
    throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotShowInFolder'));
  }
}

/**
 * Syncs the OS window theme with the in-app theme.
 *
 * Keeps the native title bar (and its native minimize/maximize/close buttons)
 * consistent with the app instead of staying light while the app is dark.
 * No-op in Web mode; failures are non-fatal and only logged.
 */
export async function setWindowTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('set_window_theme', { theme });
  } catch (err: unknown) {
    console.warn('同步窗口主题失败:', err);
  }
}

export interface DocumentHistoryEntry {
  id: string;
  createdAt: number;
  originalPath: string;
  title: string;
  bytes: number;
  sha256: string;
}

/** List local saved-document snapshots without reading their Markdown bodies. */
export async function readDocumentHistory(path: string): Promise<DocumentHistoryEntry[]> {
  if (!isTauri() || !path.trim() || path.startsWith('browser://')) return [];
  try {
    return await invoke<DocumentHistoryEntry[]>('list_document_history', { path });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

/** Read a snapshot only after validating its exact id in the hashed document store. */
export async function readDocumentSnapshot(path: string, id: string): Promise<string> {
  if (!isTauri() || !path.trim() || path.startsWith('browser://')) return '';
  try {
    return await invoke<string>('read_document_snapshot', { path, id });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

/** Best-effort history recording never blocks or fails the main document save. */
export async function recordSavedDocumentHistory(path: string, content: string, title: string): Promise<boolean> {
  if (!isTauri() || !path.trim() || path.startsWith('browser://')) return false;
  try {
    return await invoke<boolean>('record_document_history', { path, content, title });
  } catch (error) {
    console.warn('保存本地历史版本失败 / Could not save local history:', error);
    return false;
  }
}

/**
 * Reads the persisted tab session JSON from Tauri's native app-data directory.
 * Returns null in Web mode or when no session file exists yet.
 */
export async function readSessionData(): Promise<string | null> {
  if (!isTauri()) return null;
  const raw = await invoke<string | null>('read_session_data');
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

/**
 * Atomically writes the tab session JSON into Tauri's native app-data directory.
 * Avoids WebView localStorage ~5 MB quota limits for multi-document or large drafts.
 */
export async function writeSessionData(data: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('write_session_data', { data });
  } catch (err: unknown) {
    const msg = typeof err === 'string' ? err : (err as Error)?.message || '保存会话数据失败';
    throw new Error(msg, { cause: err });
  }
}

/**
 * Deletes the persisted tab session file in Tauri's native app-data directory.
 */
export async function clearSessionData(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('clear_session_data');
  } catch (err: unknown) {
    const msg = typeof err === 'string' ? err : (err as Error)?.message || '清理会话数据失败';
    throw new Error(msg, { cause: err });
  }
}

import type { WorkspaceListing, WorkspaceRenameResult } from '@/lib/workspace';

/** Folder-workspace commands keep every mutation inside the chosen root. */
export async function chooseWorkspaceFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  try { return await invoke<string | null>('choose_workspace_folder'); }
  catch (error) { throw new Error(error instanceof Error ? error.message : String(error), { cause: error }); }
}

export async function listWorkspace(root: string): Promise<WorkspaceListing> {
  if (!isTauri()) return { root, entries: [], truncated: false };
  try { return await invoke<WorkspaceListing>('list_workspace', { root }); }
  catch (error) { throw new Error(error instanceof Error ? error.message : String(error), { cause: error }); }
}

export async function createWorkspaceDocument(root: string, parent: string, name: string): Promise<string> {
  if (!isTauri()) throw new Error(t(getCurrentLanguage(), 'workspace.desktopOnly'));
  try { return await invoke<string>('create_workspace_document', { root, parent, name }); }
  catch (error) { throw new Error(error instanceof Error ? error.message : String(error), { cause: error }); }
}

export async function createWorkspaceFolder(root: string, parent: string, name: string): Promise<string> {
  if (!isTauri()) throw new Error(t(getCurrentLanguage(), 'workspace.desktopOnly'));
  try { return await invoke<string>('create_workspace_folder', { root, parent, name }); }
  catch (error) { throw new Error(error instanceof Error ? error.message : String(error), { cause: error }); }
}

export async function renameWorkspacePath(root: string, path: string, newName: string, newParent: string | null = null): Promise<WorkspaceRenameResult> {
  if (!isTauri()) throw new Error(t(getCurrentLanguage(), 'workspace.desktopOnly'));
  try { return await invoke<WorkspaceRenameResult>('rename_workspace_path', { root, path, newName, newParent }); }
  catch (error) { throw new Error(error instanceof Error ? error.message : String(error), { cause: error }); }
}

/**
 * Browser file download helper
 */
function downloadBlob(
  content: string | Uint8Array | number[],
  filename: string,
  mimeType: string
) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }
  const cleanName = filename.replace(/^browser:\/\//, '');
  let blob: Blob;
  if (typeof content === 'string') {
    blob = new Blob([content], { type: mimeType });
  } else if (content instanceof Uint8Array) {
    blob = new Blob([new Uint8Array(content.buffer, content.byteOffset, content.byteLength) as unknown as BlobPart], { type: mimeType });
  } else {
    blob = new Blob([new Uint8Array(content) as unknown as BlobPart], { type: mimeType });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
