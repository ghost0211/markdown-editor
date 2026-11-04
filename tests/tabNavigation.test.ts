import { describe, expect, it } from 'vitest';
import { cycleTabIndex, getTabCycleDirection } from '../src/lib/tabNavigation';

describe('tab keyboard navigation', () => {
  it.each([
    ['Tab', true, false, 1],
    ['Tab', true, true, -1],
    ['PageDown', true, false, 1],
    ['PageUp', true, false, -1],
  ] as const)('maps %s', (key, ctrl, shift, direction) => {
    expect(getTabCycleDirection(key, ctrl, shift)).toBe(direction);
  });

  it('ignores unmodified and unrelated keys', () => {
    expect(getTabCycleDirection('Tab', false)).toBeNull();
    expect(getTabCycleDirection('ArrowRight', true)).toBeNull();
  });

  it('wraps forward and backward', () => {
    expect(cycleTabIndex(2, 3, 1)).toBe(0);
    expect(cycleTabIndex(0, 3, -1)).toBe(2);
    expect(cycleTabIndex(0, 3, 1)).toBe(1);
  });

  it('handles a missing current tab and a single-tab list', () => {
    expect(cycleTabIndex(-1, 3, 1)).toBe(1);
    expect(cycleTabIndex(0, 1, 1)).toBeNull();
    expect(cycleTabIndex(0, 0, 1)).toBeNull();
  });
});
