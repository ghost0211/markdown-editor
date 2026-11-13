import { exportFileDialog, writeBinaryFile, writeTextFile } from '@/lib/native';

/**
 * Ensures standalone `<svg>` markup carries standard XML namespaces so external
 * viewers, browsers and rasterizers can open it directly.
 */
export function normalizeSvgForExport(svgMarkup: string): string {
  const trimmed = svgMarkup.trim();
  const openTagMatch = /^<svg\b[^>]*>/i.exec(trimmed);
  if (!openTagMatch) return trimmed;

  let openTag = openTagMatch[0];
  if (!/\bxmlns=/.test(openTag)) {
    openTag = openTag.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/\bxmlns:xlink=/.test(openTag)) {
    openTag = openTag.replace(/>$/, ' xmlns:xlink="http://www.w3.org/1999/xlink">');
  }
  return openTag + trimmed.slice(openTagMatch[0].length);
}

/**
 * Extracts intrinsic pixel dimensions from `<svg>` (`viewBox` preferred because
 * Mermaid often sets `width="100%"`).
 */
export function parseSvgDimensions(svgMarkup: string): { width: number; height: number } {
  const viewBoxMatch = /\bviewBox=["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(
    svgMarkup
  );
  if (viewBoxMatch) {
    const w = Number.parseFloat(viewBoxMatch[3]);
    const h = Number.parseFloat(viewBoxMatch[4]);
    if (w > 0 && h > 0) {
      return { width: Math.ceil(w), height: Math.ceil(h) };
    }
  }

  const widthMatch = /\bwidth=["']\s*([\d.]+)(?:px)?\s*["']/i.exec(svgMarkup);
  const heightMatch = /\bheight=["']\s*([\d.]+)(?:px)?\s*["']/i.exec(svgMarkup);
  const w = widthMatch ? Number.parseFloat(widthMatch[1]) : 0;
  const h = heightMatch ? Number.parseFloat(heightMatch[1]) : 0;
  if (w > 0 && h > 0) {
    return { width: Math.ceil(w), height: Math.ceil(h) };
  }

  return { width: 800, height: 600 };
}

/**
 * Forces explicit pixel width/height on the root `<svg>` before loading it into
 * `HTMLImageElement` (Mermaid's `width="100%"` can otherwise rasterize at 300x150).
 */
export function prepareSvgForRaster(svgMarkup: string, width: number, height: number): string {
  const normalized = normalizeSvgForExport(svgMarkup);
  const openTagMatch = /^<svg\b[^>]*>/i.exec(normalized);
  if (!openTagMatch) return normalized;

  const cleaned = openTagMatch[0]
    .replace(/\s+width=["'][^"']*["']/gi, '')
    .replace(/\s+height=["'][^"']*["']/gi, '')
    .replace(/>$/, ` width="${width}" height="${height}">`);
  return cleaned + normalized.slice(openTagMatch[0].length);
}

/**
 * Rasterizes SVG markup into PNG bytes at 2x resolution. Uses a `data:` URL
 * rather than a `blob:` URL so Chromium/WebView2 does not taint the canvas when
 * Mermaid uses `<foreignObject>` labels.
 */
export async function renderSvgToPngBytes(
  svgMarkup: string,
  options: { scale?: number; backgroundColor?: string } = {}
): Promise<Uint8Array> {
  const { width, height } = parseSvgDimensions(svgMarkup);
  const scale = options.scale ?? 2;
  const background = options.backgroundColor ?? '#ffffff';
  const rasterSvg = prepareSvgForRaster(svgMarkup, width, height);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rasterSvg)}`;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to decode SVG image'));
    el.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available');
  }

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Failed to encode PNG'));
    }, 'image/png');
  });

  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportMermaidSvg(
  svgMarkup: string,
  defaultName = 'mermaid-diagram'
): Promise<boolean> {
  const targetPath = await exportFileDialog('svg', defaultName);
  if (!targetPath) return false;
  await writeTextFile(targetPath, normalizeSvgForExport(svgMarkup));
  return true;
}

export async function exportMermaidPng(
  svgMarkup: string,
  isDark: boolean,
  defaultName = 'mermaid-diagram'
): Promise<boolean> {
  const targetPath = await exportFileDialog('png', defaultName);
  if (!targetPath) return false;
  const bytes = await renderSvgToPngBytes(svgMarkup, {
    scale: 2,
    backgroundColor: isDark ? '#0f172a' : '#ffffff',
  });
  await writeBinaryFile(targetPath, bytes);
  return true;
}
