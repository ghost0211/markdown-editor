import {
  buildStandaloneHtml,
  exportMarkdownToHtml,
  escapeHtml,
  SANITIZE_SCHEMA,
  type HtmlRenderOptions,
} from './htmlExporter';
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
 * Converts markdown directly to PDF file via printable HTML and headless browser backend
 */
export async function exportMarkdownToPdf(
  markdown: string,
  title: string,
  targetPath: string,
  sourceFilePath?: string,
  lang?: string
): Promise<void> {
  const html = await buildPrintableHtml(markdown, title, {
    sourceFilePath,
    lang,
  });
  await exportPdfFromHtml(targetPath, html);
}
