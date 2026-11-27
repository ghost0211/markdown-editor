import { parseSvgDimensions } from '@/lib/export/mermaidExporter';

export const MERMAID_MIN_ZOOM = 0.1;
export const MERMAID_MAX_ZOOM = 8;
export const MERMAID_FIT_MAX_ZOOM = 1.5;
export const MERMAID_ZOOM_STEP = 1.25;
export const MERMAID_PAN_KEY_STEP = 80;

export interface MermaidViewport {
  scale: number;
  x: number;
  y: number;
}

export function clampMermaidScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MERMAID_MAX_ZOOM, Math.max(MERMAID_MIN_ZOOM, scale));
}

/**
 * Fits the diagram cleanly inside the viewer stage with breathing room and
 * centers it. Caps auto-fit scale at `MERMAID_FIT_MAX_ZOOM` so tiny diagrams
 * stay visually comfortable instead of blowing up across an entire monitor.
 */
export function computeFitViewport(
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
  padding = 48
): MermaidViewport {
  const vw = Math.max(1, viewportWidth);
  const vh = Math.max(1, viewportHeight);
  const cw = Math.max(1, contentWidth);
  const ch = Math.max(1, contentHeight);

  const usableW = Math.max(1, vw - padding * 2);
  const usableH = Math.max(1, vh - padding * 2);
  const rawScale = Math.min(usableW / cw, usableH / ch, MERMAID_FIT_MAX_ZOOM);
  const scale = clampMermaidScale(rawScale);

  return {
    scale,
    x: (vw - cw * scale) / 2,
    y: (vh - ch * scale) / 2,
  };
}

/**
 * Computes a 100% (1:1) viewport. Diagrams smaller than the stage stay centered;
 * oversized diagrams align to the top-left padding so users immediately see the
 * start of a wide left-to-right or tall top-to-bottom flowchart.
 */
export function computeActualSizeViewport(
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
  padding = 48
): MermaidViewport {
  const vw = Math.max(1, viewportWidth);
  const vh = Math.max(1, viewportHeight);
  const cw = Math.max(1, contentWidth);
  const ch = Math.max(1, contentHeight);

  const x = cw > vw - padding * 2 ? padding : (vw - cw) / 2;
  const y = ch > vh - padding * 2 ? padding : (vh - ch) / 2;

  return { scale: 1, x, y };
}

/**
 * Zooms to `targetScale` while keeping the content point underneath
 * `(anchorX, anchorY)` pinned at the exact same screen coordinates.
 */
export function zoomViewportAtPoint(
  viewport: MermaidViewport,
  targetScale: number,
  anchorX: number,
  anchorY: number
): MermaidViewport {
  const nextScale = clampMermaidScale(targetScale);
  const currentScale = viewport.scale > 0 ? viewport.scale : 1;
  const ratio = nextScale / currentScale;

  return {
    scale: nextScale,
    x: anchorX - (anchorX - viewport.x) * ratio,
    y: anchorY - (anchorY - viewport.y) * ratio,
  };
}

/**
 * Converts a wheel event delta into a smooth exponential zoom factor.
 * Clamps extreme single-tick deltas so fast trackpad flings remain controlled.
 */
export function wheelDeltaToScale(
  currentScale: number,
  deltaY: number,
  ctrlKey = false
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return clampMermaidScale(currentScale);
  }
  const clampedDelta = Math.max(-240, Math.min(240, deltaY));
  const sensitivity = ctrlKey ? 0.008 : 0.0018;
  const factor = Math.exp(-clampedDelta * sensitivity);
  return clampMermaidScale(currentScale * factor);
}

export function panViewport(
  viewport: MermaidViewport,
  dx: number,
  dy: number
): MermaidViewport {
  return {
    scale: viewport.scale,
    x: viewport.x + dx,
    y: viewport.y + dy,
  };
}

export function formatZoomPercent(scale: number): string {
  return `${Math.round(clampMermaidScale(scale) * 100)}%`;
}

/**
 * Prepares Mermaid SVG markup for mounting in the fullscreen lightbox:
 * 1. Namespaces the diagram's root ID across `<style>`, `<defs>`, and `url(#...)`
 *    references so it never collides with the inline SVG still mounted behind it.
 * 2. Replaces Mermaid's `width="100%"` / inline `max-width` constraint with
 *    explicit intrinsic pixel dimensions so CSS transform scaling renders crisp
 *    vectors at any zoom level.
 */
export function prepareSvgForLightbox(
  svgMarkup: string,
  prefix = 'mermaid-lb-'
): { svg: string; width: number; height: number } {
  const { width, height } = parseSvgDimensions(svgMarkup);
  let output = svgMarkup.trim();

  const openTagMatch = /^<svg\b[^>]*>/i.exec(output);
  if (!openTagMatch) {
    return { svg: output, width, height };
  }

  const rootIdMatch = /\bid=["']([^"']+)["']/i.exec(openTagMatch[0]);
  if (rootIdMatch?.[1]) {
    const rootId = rootIdMatch[1];
    if (!rootId.startsWith(prefix)) {
      output = output.split(rootId).join(`${prefix}${rootId}`);
    }
  }

  const refreshedOpenTagMatch = /^<svg\b[^>]*>/i.exec(output);
  if (refreshedOpenTagMatch) {
    let openTag = refreshedOpenTagMatch[0]
      .replace(/\s+width=["'][^"']*["']/gi, '')
      .replace(/\s+height=["'][^"']*["']/gi, '');
    openTag = openTag.replace(
      /\s+style=["']([^"']*)["']/i,
      (_full, styleBody: string) => {
        const cleanedStyle = styleBody
          .replace(/(?:^|;)\s*max-width\s*:[^;]+/gi, '')
          .replace(/^;\s*/, '')
          .trim();
        return cleanedStyle ? ` style="${cleanedStyle}"` : '';
      }
    );
    openTag = openTag.replace(/>$/, ` width="${width}" height="${height}">`);
    output = openTag + output.slice(refreshedOpenTagMatch[0].length);
  }

  return { svg: output, width, height };
}
