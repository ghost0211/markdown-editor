import { getExportFilename, getFileNameFromPath } from '@/lib/documentUtils';
import { readTextFile, writeNewExportFile } from '@/lib/native';
import { workspaceEntryAbsolutePath } from '@/lib/workspace';
import type { ExportStyle, Language } from '@/types';

export type BatchExportFormat = 'docx' | 'pdf' | 'html';

export interface BatchExportSource {
  path: string;
  title: string;
  content?: string;
}

export interface BatchExportResult {
  source: BatchExportSource;
  output: string;
  error?: string;
}

export function makeBatchExportNames(sources: readonly BatchExportSource[], format: BatchExportFormat): string[] {
  const used = new Set<string>();
  return sources.map(({ path, title }) => {
    const filename = getExportFilename(getFileNameFromPath(path) || title, format);
    const stem = filename.slice(0, -format.length - 1).slice(0, 180);
    let name = stem + '.' + format;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix++) {
      name = stem + ' (' + suffix + ').' + format;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

export async function runBatchExport(
  sources: readonly BatchExportSource[],
  destination: string,
  format: BatchExportFormat,
  options: { language: Language; style?: ExportStyle; embedImages: boolean },
  signal: AbortSignal,
  onResult: (result: BatchExportResult) => void
): Promise<void> {
  const names = makeBatchExportNames(sources, format);
  for (const [index, source] of sources.entries()) {
    if (signal.aborted) break;
    const path = workspaceEntryAbsolutePath(destination, names[index]);
    const result = { source, output: path ?? names[index] };
    try {
      if (!path) throw new Error('Invalid export path');
      const content = source.content ?? await readTextFile(source.path);
      if (signal.aborted) break;
      const { language, style, embedImages } = options;
      if (format === 'docx') {
        const { exportMarkdownToDocx } = await import('@/lib/export/docxExporter');
        await writeNewExportFile(path, await exportMarkdownToDocx(content, source.title, language, style));
      } else if (format === 'pdf') {
        const { exportMarkdownToPdf } = await import('@/lib/export/pdfExporter');
        await exportMarkdownToPdf(content, source.title, path, source.path, language, style, true);
      } else {
        const { buildStandaloneHtml } = await import('@/lib/export/htmlExporter');
        const resolveImage = embedImages
          ? await (await import('@/lib/export/embedImages')).createLocalImageResolver(source.path)
          : undefined;
        const html = await buildStandaloneHtml(content, source.title, {
          sourceFilePath: source.path, lang: language, resolveImage, style,
        });
        await writeNewExportFile(path, new TextEncoder().encode(html));
      }
      onResult(result);
    } catch (error) {
      onResult({ ...result, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
