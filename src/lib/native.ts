import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { OpenFileResult } from '@/types';
import { t, getCurrentLanguage } from '@/i18n';

export const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export type ExportFormat = 'docx' | 'pdf' | 'html';

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
      throw new Error(msg);
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
      return await invoke<string>('read_text_file', { path });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '读取文件失败';
      throw new Error(msg);
    }
  } else {
    throw new Error(t(getCurrentLanguage(), 'browserFallback.webCannotReadByPath'));
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

/**
 * Writes UTF-8 content to a file.
 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('write_text_file', { path, content });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '保存文件失败';
      throw new Error(msg);
    }
  } else {
    // Web fallback: Trigger browser file download with appropriate MIME
    const lower = path.toLowerCase();
    const mimeType = lower.endsWith('.html') || lower.endsWith('.htm')
      ? 'text/html;charset=utf-8'
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
      throw new Error(msg);
    }
  } else {
    downloadBlob(content, path || 'document.html', 'text/html;charset=utf-8');
  }
}

/**
 * Writes binary content (e.g. .docx buffer) to a file.
 */
export async function writeBinaryFile(path: string, data: Uint8Array | number[]): Promise<void> {
  if (isTauri()) {
    try {
      const payload = data instanceof Uint8Array ? Array.from(data) : data;
      await invoke('write_binary_file', { path, data: payload });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '保存二进制文件失败';
      throw new Error(msg);
    }
  } else {
    // Web fallback: Trigger browser file download with appropriate mime
    const lower = path.toLowerCase();
    const mimeType = lower.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : lower.endsWith('.pdf')
      ? 'application/pdf'
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
      throw new Error(msg);
    }
  } else {
    // Browser fallback
    if (typeof document === 'undefined') {
      return null;
    }

    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.mdown,.mkd,.txt';
      input.style.display = 'none';

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        try {
          const text = await file.text();
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

/**
 * Opens native save file dialog to select a destination path.
 */
export async function saveFileDialog(defaultName?: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string | null>('save_file_dialog', { defaultName });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '保存对话框失败';
      throw new Error(msg);
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
      throw new Error(msg);
    }
  } else {
    // Browser fallback: prompts user for filename
    if (typeof window === 'undefined') return null;
    const lang = getCurrentLanguage();
    const base = (defaultName || t(lang, 'common.untitled')).replace(
      /\.(md|markdown|mdown|mkd|txt|docx|pdf|html|htm)$/i,
      ''
    );
    const promptName = `${base}.${format}`;
    const name = window.prompt(
      t(lang, 'browserFallback.promptExportFilename', { format: format.toUpperCase() }),
      promptName
    );
    if (!name) return null;
    const finalName = name.toLowerCase().endsWith(`.${format}`) ? name : `${name}.${format}`;
    return `browser://${finalName}`;
  }
}

/**
 * Converts HTML to PDF via headless Edge (in Tauri) or browser print dialog (in Web mode).
 */
export async function exportPdfFromHtml(path: string, html: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('export_pdf_from_html', { path, html });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || 'PDF 导出失败';
      throw new Error(msg);
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
