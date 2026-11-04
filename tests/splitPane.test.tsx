import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SplitPane,
  type SplitPaneProps,
} from '../src/components/SplitPane';
import {
  DEFAULT_MAX_RATIO,
  DEFAULT_MIN_RATIO,
  RATIO_STEP,
  clampRatio,
  normalizeBounds,
  ratioFromKeyboard,
  ratioFromPointer,
  ratioToPercent,
} from '../src/lib/splitPane';

describe('SplitPane pure ratio helpers (src/lib/splitPane.ts)', () => {
  describe('normalizeBounds', () => {
    it('returns the default 0.25..0.75 range when called without arguments', () => {
      expect(normalizeBounds()).toEqual({
        minRatio: DEFAULT_MIN_RATIO,
        maxRatio: DEFAULT_MAX_RATIO,
      });
    });

    it('clamps custom bounds into [0, 1]', () => {
      expect(normalizeBounds(-0.5, 2)).toEqual({ minRatio: 0, maxRatio: 1 });
      expect(normalizeBounds(0.1, 0.9)).toEqual({
        minRatio: 0.1,
        maxRatio: 0.9,
      });
    });

    it('swaps reversed bounds instead of creating an empty range', () => {
      expect(normalizeBounds(0.8, 0.2)).toEqual({
        minRatio: 0.2,
        maxRatio: 0.8,
      });
    });

    it('falls back to defaults for non-finite bounds', () => {
      expect(normalizeBounds(Number.NaN, Number.NaN)).toEqual({
        minRatio: DEFAULT_MIN_RATIO,
        maxRatio: DEFAULT_MAX_RATIO,
      });
      expect(normalizeBounds(0.6, Number.POSITIVE_INFINITY)).toEqual({
        minRatio: 0.6,
        maxRatio: DEFAULT_MAX_RATIO,
      });
    });

    it('keeps a valid but degenerate range (min === max)', () => {
      expect(normalizeBounds(0.5, 0.5)).toEqual({
        minRatio: 0.5,
        maxRatio: 0.5,
      });
    });
  });

  describe('clampRatio', () => {
    it('passes through ratios inside the default range', () => {
      expect(clampRatio(0.4)).toBe(0.4);
      expect(clampRatio(0.25)).toBe(0.25);
      expect(clampRatio(0.75)).toBe(0.75);
    });

    it('clamps ratios outside the default range', () => {
      expect(clampRatio(0.1)).toBe(0.25);
      expect(clampRatio(0.9)).toBe(0.75);
      expect(clampRatio(-1)).toBe(0.25);
      expect(clampRatio(2)).toBe(0.75);
    });

    it('honours custom bounds and normalizes them first', () => {
      expect(clampRatio(0.05, 0.1, 0.9)).toBe(0.1);
      expect(clampRatio(0.95, 0.1, 0.9)).toBe(0.9);
      // Reversed bounds are normalized to 0.2..0.8.
      expect(clampRatio(0.1, 0.8, 0.2)).toBe(0.2);
      expect(clampRatio(0.9, 0.8, 0.2)).toBe(0.8);
    });

    it('falls back to the minimum for non-finite ratios', () => {
      expect(clampRatio(Number.NaN, 0.1, 0.9)).toBe(0.1);
      expect(clampRatio(Number.POSITIVE_INFINITY, 0.1, 0.9)).toBe(0.9);
    });

    it('supports a fully locked range', () => {
      expect(clampRatio(0.1, 0.5, 0.5)).toBe(0.5);
      expect(clampRatio(0.9, 0.5, 0.5)).toBe(0.5);
    });
  });

  describe('ratioFromPointer', () => {
    it('maps the container width to the allowed ratio range', () => {
      expect(ratioFromPointer(500, 0, 1000)).toBe(0.5);
      expect(ratioFromPointer(250, 0, 1000)).toBe(0.25);
      expect(ratioFromPointer(750, 0, 1000)).toBe(0.75);
    });

    it('accounts for the container left offset', () => {
      expect(ratioFromPointer(600, 100, 1000)).toBe(0.5);
      expect(ratioFromPointer(450, -50, 1000)).toBe(0.5);
    });

    it('clamps pointer positions beyond either edge', () => {
      expect(ratioFromPointer(-200, 0, 1000)).toBe(0.25);
      expect(ratioFromPointer(0, 0, 1000)).toBe(0.25);
      expect(ratioFromPointer(1000, 0, 1000)).toBe(0.75);
      expect(ratioFromPointer(5000, 0, 1000)).toBe(0.75);
    });

    it('respects custom bounds', () => {
      expect(ratioFromPointer(100, 0, 1000, 0.1, 0.9)).toBe(0.1);
      expect(ratioFromPointer(500, 0, 1000, 0.1, 0.9)).toBe(0.5);
      expect(ratioFromPointer(950, 0, 1000, 0.1, 0.9)).toBe(0.9);
    });

    it('returns the minimum for a zero, negative or non-finite width', () => {
      expect(ratioFromPointer(500, 0, 0)).toBe(0.25);
      expect(ratioFromPointer(500, 0, -100)).toBe(0.25);
      expect(ratioFromPointer(500, 0, Number.NaN)).toBe(0.25);
      expect(ratioFromPointer(500, 0, 0, 0.1, 0.9)).toBe(0.1);
    });

    it('stays inside the bounds for a sweep of pointer positions', () => {
      for (let x = -100; x <= 1100; x += 10) {
        const value = ratioFromPointer(x, 0, 1000, 0.2, 0.8);
        expect(value).toBeGreaterThanOrEqual(0.2);
        expect(value).toBeLessThanOrEqual(0.8);
      }
    });
  });

  describe('ratioFromKeyboard', () => {
    it('uses the default 2% step for ArrowLeft / ArrowRight', () => {
      expect(RATIO_STEP).toBe(0.02);
      expect(ratioFromKeyboard(0.5, 'ArrowRight')).toBe(0.52);
      expect(ratioFromKeyboard(0.5, 'ArrowLeft')).toBe(0.48);
    });

    it('supports a custom step', () => {
      expect(ratioFromKeyboard(0.5, 'ArrowRight', 0.25, 0.75, 0.1)).toBe(0.6);
      expect(ratioFromKeyboard(0.5, 'ArrowLeft', 0.25, 0.75, 0.1)).toBe(0.4);
    });

    it('clamps arrow adjustments at minRatio / maxRatio', () => {
      expect(ratioFromKeyboard(0.25, 'ArrowLeft')).toBe(0.25);
      expect(ratioFromKeyboard(0.26, 'ArrowLeft')).toBe(0.25);
      expect(ratioFromKeyboard(0.75, 'ArrowRight')).toBe(0.75);
      expect(ratioFromKeyboard(0.74, 'ArrowRight')).toBe(0.75);
    });

    it('jumps to the configured bounds for Home / End', () => {
      expect(ratioFromKeyboard(0.5, 'Home')).toBe(0.25);
      expect(ratioFromKeyboard(0.5, 'End')).toBe(0.75);
      expect(ratioFromKeyboard(0.5, 'Home', 0.1, 0.9)).toBe(0.1);
      expect(ratioFromKeyboard(0.5, 'End', 0.1, 0.9)).toBe(0.9);
      expect(ratioFromKeyboard(0.5, 'End', 0.6, 0.6)).toBe(0.6);
    });

    it('normalizes reversed bounds before computing', () => {
      expect(ratioFromKeyboard(0.5, 'Home', 0.8, 0.2)).toBe(0.2);
      expect(ratioFromKeyboard(0.5, 'End', 0.8, 0.2)).toBe(0.8);
    });

    it('rounds floating point drift away', () => {
      expect(ratioFromKeyboard(0.1, 'ArrowRight')).toBe(0.27);
      expect(ratioFromKeyboard(0.48, 'ArrowRight')).toBe(0.5);
      expect(ratioFromKeyboard(0.5, 'ArrowRight', 0.25, 0.75, 0.1)).toBe(0.6);
    });

    it('returns null for keys it does not handle', () => {
      expect(ratioFromKeyboard(0.5, 'ArrowUp')).toBeNull();
      expect(ratioFromKeyboard(0.5, 'PageDown')).toBeNull();
      expect(ratioFromKeyboard(0.5, 'a')).toBeNull();
      expect(ratioFromKeyboard(0.5, ' ')).toBeNull();
    });

    it('starts from the clamped ratio for non-finite input', () => {
      expect(ratioFromKeyboard(Number.NaN, 'ArrowRight')).toBe(0.27);
      expect(ratioFromKeyboard(Number.NaN, 'Home')).toBe(0.25);
    });
  });

  describe('ratioToPercent', () => {
    it('rounds ratios to integer percentages', () => {
      expect(ratioToPercent(0.4)).toBe(40);
      expect(ratioToPercent(0.333)).toBe(33);
      expect(ratioToPercent(0.335)).toBe(34);
      expect(ratioToPercent(0.25)).toBe(25);
      expect(ratioToPercent(0.75)).toBe(75);
    });

    it('clamps out-of-range and non-finite values', () => {
      expect(ratioToPercent(2)).toBe(100);
      expect(ratioToPercent(-1)).toBe(0);
      expect(ratioToPercent(Number.NaN)).toBe(0);
    });
  });
});

describe('SplitPane component SSR & accessibility (src/components/SplitPane.tsx)', () => {
  function renderSplitPane(
    overrides: Partial<SplitPaneProps> = {}
  ): string {
    return renderToStaticMarkup(
      <SplitPane
        left={<div data-pane="left">Editor content</div>}
        right={<div data-pane="right">Preview content</div>}
        ratio={0.4}
        onRatioChange={vi.fn()}
        {...overrides}
      />
    );
  }

  it('renders both panes and the separator during server-side rendering', () => {
    const html = renderSplitPane();

    expect(html).toContain('Editor content');
    expect(html).toContain('Preview content');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Resize panels"');
  });

  it('exposes the default range through ARIA value attributes', () => {
    const html = renderSplitPane({ ratio: 0.4 });

    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('aria-valuemin="25"');
    expect(html).toContain('aria-valuemax="75"');
    expect(html).toContain('aria-valuetext="40%"');
  });

  it('gives the left pane an exact percentage basis and lets the right pane fill the rest', () => {
    const html = renderSplitPane({ ratio: 0.4 });

    expect(html).toMatch(/flex:\s*0 0 40%/);
    // The separator must not consume the left pane's percentage.
    expect(html).toContain('w-1.5');
    // Panes must be able to shrink below their content width, otherwise a wide
    // preview forces horizontal overflow instead of respecting the ratio.
    expect(html).toContain('min-w-0');
  });

  it('applies custom minRatio / maxRatio and clamps the displayed ratio', () => {
    const html = renderSplitPane({ ratio: 0.95, minRatio: 0.1, maxRatio: 0.8 });

    expect(html).toContain('aria-valuenow="80"');
    expect(html).toContain('aria-valuemin="10"');
    expect(html).toContain('aria-valuemax="80"');
    expect(html).toMatch(/flex:\s*0 0 80%/);
  });

  it('normalizes reversed bounds for the rendered ARIA range', () => {
    const html = renderSplitPane({ ratio: 0.5, minRatio: 0.8, maxRatio: 0.2 });

    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuemin="20"');
    expect(html).toContain('aria-valuemax="80"');
  });

  it('falls back to minRatio for a non-finite controlled ratio', () => {
    const html = renderSplitPane({ ratio: Number.NaN });

    expect(html).toContain('aria-valuenow="25"');
    expect(html).toMatch(/flex:\s*0 0 25%/);
  });

  it('links the separator to both panes through unique ids', () => {
    const html = renderSplitPane();

    const match = /aria-controls="([^"]+)"/.exec(html);
    expect(match).not.toBeNull();

    const controlledIds = match![1].split(' ');
    expect(controlledIds).toHaveLength(2);
    for (const id of controlledIds) {
      expect(id.length).toBeGreaterThan(0);
      expect(html).toContain(`id="${id}"`);
    }
    expect(controlledIds[0]).not.toBe(controlledIds[1]);
  });

  it('passes a custom className through to the outer flex container', () => {
    const html = renderSplitPane({ className: 'my-split-shell' });
    expect(html).toContain('my-split-shell');
  });

  it('works without the optional onRatioCommit callback', () => {
    const html = renderSplitPane({ onRatioCommit: undefined });
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="40"');
  });

  it('is safe to render in Node (no window/document access at render time)', () => {
    // renderToStaticMarkup already proves this: a module-level window/document
    // access would throw here because Vitest runs in the node environment.
    expect(renderSplitPane).not.toThrow();
    expect(renderSplitPane()).toContain('role="separator"');
  });
});
