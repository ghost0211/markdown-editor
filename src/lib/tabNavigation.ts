export type TabCycleDirection = 1 | -1;

/** Maps browser-style tab keyboard shortcuts to a cycling direction. */
export function getTabCycleDirection(
  key: string,
  ctrlOrMeta: boolean,
  shiftKey = false
): TabCycleDirection | null {
  if (!ctrlOrMeta) return null;
  if (key === 'Tab') return shiftKey ? -1 : 1;
  if (key === 'PageDown') return 1;
  if (key === 'PageUp') return -1;
  return null;
}

/** Wraps in both directions and safely handles an unknown current index. */
export function cycleTabIndex(
  currentIndex: number,
  count: number,
  direction: TabCycleDirection
): number | null {
  if (count < 2) return null;
  const base = currentIndex >= 0 && currentIndex < count ? currentIndex : 0;
  return (base + direction + count) % count;
}
