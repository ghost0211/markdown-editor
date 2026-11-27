import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n';
import { MermaidLightboxDialog } from '../src/components/MermaidLightbox';
import {
  MERMAID_FIT_MAX_ZOOM,
  MERMAID_MAX_ZOOM,
  MERMAID_MIN_ZOOM,
  clampMermaidScale,
  computeActualSizeViewport,
  computeFitViewport,
  formatZoomPercent,
  panViewport,
  prepareSvgForLightbox,
  wheelDeltaToScale,
  zoomViewportAtPoint,
} from '../src/lib/mermaidViewport';

describe('Mermaid fullscreen viewport & SVG preparation', () => {
  it('clamps zoom scales safely within [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(clampMermaidScale(0.01)).toBe(MERMAID_MIN_ZOOM);
    expect(clampMermaidScale(100)).toBe(MERMAID_MAX_ZOOM);
    expect(clampMermaidScale(Number.NaN)).toBe(1);
    expect(clampMermaidScale(-2)).toBe(1);
    expect(clampMermaidScale(1.75)).toBe(1.75);
  });

  it('fits wide multi-node diagrams into the stage and centers them', () => {
    // Wide architecture flowchart: 2400x800 inside a 1296x796 stage (padding=48 -> usable 1200x700)
    const vp = computeFitViewport(1296, 796, 2400, 800, 48);
    expect(vp.scale).toBeCloseTo(0.5, 5);
    expect(vp.x).toBeCloseTo(48, 5);
    expect(vp.y).toBeCloseTo((796 - 400) / 2, 5);
  });

  it('caps fit-to-screen zoom on tiny diagrams to keep them comfortable', () => {
    const vp = computeFitViewport(1400, 900, 200, 120, 48);
    expect(vp.scale).toBe(MERMAID_FIT_MAX_ZOOM);
    expect(vp.x).toBeCloseTo((1400 - 200 * MERMAID_FIT_MAX_ZOOM) / 2, 5);
    expect(vp.y).toBeCloseTo((900 - 120 * MERMAID_FIT_MAX_ZOOM) / 2, 5);
  });

  it('aligns oversized diagrams to top-left padding at 100% actual size and centers small ones', () => {
    const oversized = computeActualSizeViewport(1200, 700, 2400, 1200, 48);
    expect(oversized).toEqual({ scale: 1, x: 48, y: 48 });

    const compact = computeActualSizeViewport(1200, 700, 400, 300, 48);
    expect(compact).toEqual({ scale: 1, x: 400, y: 200 });
  });

  it('zooms around the mouse anchor point without shifting the content under the cursor', () => {
    const initial = { scale: 0.5, x: 100, y: 60 };
    const anchorX = 420;
    const anchorY = 260;

    // World point beneath the cursor before zoom:
    const worldXBefore = (anchorX - initial.x) / initial.scale;
    const worldYBefore = (anchorY - initial.y) / initial.scale;

    const zoomed = zoomViewportAtPoint(initial, 1.5, anchorX, anchorY);
    const worldXAfter = (anchorX - zoomed.x) / zoomed.scale;
    const worldYAfter = (anchorY - zoomed.y) / zoomed.scale;

    expect(zoomed.scale).toBe(1.5);
    expect(worldXAfter).toBeCloseTo(worldXBefore, 6);
    expect(worldYAfter).toBeCloseTo(worldYBefore, 6);
  });

  it('converts wheel deltas smoothly into clamped scales (mouse wheel and ctrl+pinch)', () => {
    const zoomedIn = wheelDeltaToScale(1, -120, false);
    const zoomedOut = wheelDeltaToScale(1, 120, false);
    expect(zoomedIn).toBeGreaterThan(1);
    expect(zoomedOut).toBeLessThan(1);

    // Pinch (ctrlKey=true) responds more sensitively to smaller deltas
    const pinchIn = wheelDeltaToScale(1, -30, true);
    const wheelSmallIn = wheelDeltaToScale(1, -30, false);
    expect(pinchIn).toBeGreaterThan(wheelSmallIn);

    // Extreme single-event spikes are clamped so scale does not explode uncontrollably
    const hugeSpike = wheelDeltaToScale(1, -5000, false);
    const cappedSpike = wheelDeltaToScale(1, -240, false);
    expect(hugeSpike).toBeCloseTo(cappedSpike, 6);
  });

  it('pans viewport offsets and formats zoom percentages', () => {
    expect(panViewport({ scale: 1.2, x: 10, y: 20 }, -35, 15)).toEqual({
      scale: 1.2,
      x: -25,
      y: 35,
    });
    expect(formatZoomPercent(0.496)).toBe('50%');
    expect(formatZoomPercent(2.5)).toBe('250%');
  });

  it('namespaces SVG IDs and replaces max-width with explicit intrinsic dimensions', () => {
    const sampleSvg =
      '<svg id="mermaid-abc-1" width="100%" style="max-width: 1200px; background: transparent;" viewBox="0 0 1850.4 640.2">' +
      '<style>#mermaid-abc-1 .node { fill: #fff; }</style>' +
      '<defs><marker id="mermaid-abc-1_arrow"></marker></defs>' +
      '<path marker-end="url(#mermaid-abc-1_arrow)" d="M0 0 L10 10" />' +
      '</svg>';

    const prepared = prepareSvgForLightbox(sampleSvg);
    expect(prepared.width).toBe(1851);
    expect(prepared.height).toBe(641);

    // Root ID, style selectors, defs marker IDs, and url(#...) references are all namespaced
    expect(prepared.svg).toContain('id="mermaid-lb-mermaid-abc-1"');
    expect(prepared.svg).toContain('#mermaid-lb-mermaid-abc-1 .node');
    expect(prepared.svg).toContain('id="mermaid-lb-mermaid-abc-1_arrow"');
    expect(prepared.svg).toContain('url(#mermaid-lb-mermaid-abc-1_arrow)');
    expect(prepared.svg).not.toContain('id="mermaid-abc-1"');

    // max-width constraint removed and explicit width/height applied
    expect(prepared.svg).not.toContain('max-width');
    expect(prepared.svg).toContain('background: transparent;');
    expect(prepared.svg).toContain('width="1851" height="641"');
  });
});

describe('MermaidLightboxDialog accessibility & localized controls', () => {
  const sampleSvg = '<svg id="mermaid-test-1" viewBox="0 0 1200 600"><rect width="1200" height="600"/></svg>';

  it('renders accessible dialog with zoom, fit, actual size, export, and close controls in zh-CN', () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <MermaidLightboxDialog svg={sampleSvg} isDark={false} onClose={vi.fn()} />
      </I18nProvider>
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Mermaid 图表全屏查看"');
    expect(html).toContain('aria-label="放大 (+)"');
    expect(html).toContain('aria-label="缩小 (-)"');
    expect(html).toContain('aria-label="适应窗口 (0)"');
    expect(html).toContain('aria-label="实际大小 100% (1)"');
    expect(html).toContain('aria-label="导出 SVG"');
    expect(html).toContain('aria-label="导出 PNG"');
    expect(html).toContain('aria-label="关闭 (Esc)"');
    expect(html).toContain('id="mermaid-lb-mermaid-test-1"');
  });

  it('renders localized controls in en-US', () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="en-US">
        <MermaidLightboxDialog svg={sampleSvg} isDark={true} onClose={vi.fn()} />
      </I18nProvider>
    );

    expect(html).toContain('aria-label="Mermaid Diagram Viewer"');
    expect(html).toContain('aria-label="Zoom in (+)"');
    expect(html).toContain('aria-label="Zoom out (-)"');
    expect(html).toContain('aria-label="Fit to window (0)"');
    expect(html).toContain('aria-label="Actual size 100% (1)"');
    expect(html).toContain('aria-label="Export as SVG"');
    expect(html).toContain('aria-label="Export as PNG"');
    expect(html).toContain('aria-label="Close (Esc)"');
  });
});
