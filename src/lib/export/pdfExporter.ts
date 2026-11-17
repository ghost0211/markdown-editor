import {
  buildStandaloneHtml,
  exportMarkdownToHtml,
  escapeHtml,
  SANITIZE_SCHEMA,
  type HtmlRenderOptions,
} from './htmlExporter';
import { validateExportStyle, type ExportStyle } from '../exportStyle';
import { exportPdfFromHtml } from '../native';

export { escapeHtml, SANITIZE_SCHEMA, type HtmlRenderOptions, exportMarkdownToHtml };

/**
 * Builds standalone printable HTML with Chinese font support, A4 pagination, and security sanitization.
 * Maintains full backward compatibility with previous call signatures.
 */
export async function buildPrintableHtml(
  markdown: string,
  title?: string,
  sourceFilePathOrOptions?: string | HtmlRenderOptions
): Promise<string> {
  const options: HtmlRenderOptions =
    typeof sourceFilePathOrOptions === 'string'
      ? { sourceFilePath: sourceFilePathOrOptions }
      : sourceFilePathOrOptions || {};

  return buildStandaloneHtml(markdown, title, options);
}

/**
 * Converts markdown directly to PDF file via printable HTML and headless browser backend.
 *
 * PDF page numbers are delegated to Edge's native print header/footer because
 * Chromium/Edge do not expose reliable CSS page counters. Consequently:
 * - `style.headerText` is intentionally a plain-HTML/Word feature; PDF keeps
 *   the browser's native header area instead of inventing a fake page footer.
 * - `style.pageNumbers === true` removes `--no-pdf-header-footer` on the Rust
 *   side, letting Edge draw its native header/footer.
 */
export async function exportMarkdownToPdf(
  markdown: string,
  title: string,
  targetPath: string,
  sourceFilePath?: string,
  lang?: string,
  style?: ExportStyle
): Promise<void> {
  const normalizedStyle = style ? validateExportStyle(style) : undefined;
  const htmlStyle = normalizedStyle
    ? {
        ...normalizedStyle,
        // These two are handled by Edge itself for PDF, so do not emit the
        // HTML-only running header/footer into the printed document as well.
        headerText: '',
        pageNumbers: false,
      }
    : undefined;

  const html = await buildPrintableHtml(markdown, title, {
    sourceFilePath,
    lang,
    style: htmlStyle,
  });
  await exportPdfFromHtml(targetPath, html, normalizedStyle?.pageNumbers === true);
}
