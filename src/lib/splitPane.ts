/**
 * Pure geometry / keyboard helpers for the SplitPane component.
 *
 * Kept free of DOM access so the behaviour can be unit tested in Vitest's
 * Node environment and reused by callers that need to persist or validate a
 * split ratio themselves.
 */

export const DEFAULT_MIN_RATIO = 0.25;
export const DEFAULT_MAX_RATIO = 0.75;
export const RATIO_STEP = 0.02;

export interface RatioBounds {
  minRatio: number;
  maxRatio: number;
}

function clampUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Clamp the configured bounds into [0, 1] and guarantee min <= max.
 * If the caller passes them in reverse order they are swapped rather than
 * silently producing an empty (immovable) range.
 */
export function normalizeBounds(
  minRatio: number = DEFAULT_MIN_RATIO,
  maxRatio: number = DEFAULT_MAX_RATIO
): RatioBounds {
  const min = clampUnit(minRatio, DEFAULT_MIN_RATIO);
  const max = clampUnit(maxRatio, DEFAULT_MAX_RATIO);
  return min <= max
    ? { minRatio: min, maxRatio: max }
    : { minRatio: max, maxRatio: min };
}

/** Clamp a ratio into the (normalized) allowed range. Non-finite input -> min. */
export function clampRatio(
  ratio: number,
  minRatio: number = DEFAULT_MIN_RATIO,
  maxRatio: number = DEFAULT_MAX_RATIO
): number {
  const bounds = normalizeBounds(minRatio, maxRatio);
  if (Number.isNaN(ratio)) return bounds.minRatio;
  if (ratio === Number.POSITIVE_INFINITY) return bounds.maxRatio;
  if (ratio === Number.NEGATIVE_INFINITY) return bounds.minRatio;
  return Math.min(bounds.maxRatio, Math.max(bounds.minRatio, ratio));
}

/**
 * Convert a pointer's viewport X coordinate into a ratio of the container
 * width. `containerLeft` should be the container's bounding-client rect left,
 * i.e. this assumes the separator spans the container's full height and the
 * left pane starts at the container's left edge (the normal flex layout).
 */
export function ratioFromPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
  minRatio: number = DEFAULT_MIN_RATIO,
  maxRatio: number = DEFAULT_MAX_RATIO
): number {
  const bounds = normalizeBounds(minRatio, maxRatio);
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return bounds.minRatio;
  }
  return clampRatio(
    (clientX - containerLeft) / containerWidth,
    bounds.minRatio,
    bounds.maxRatio
  );
}

/**
 * Resolve a keyboard event key into the next ratio.
 * Returns null for keys the separator does not handle, so callers can let the
 * event bubble. Home/End jump to the configured (not absolute 0/1) edges.
 */
export function ratioFromKeyboard(
  currentRatio: number,
  key: string,
  minRatio: number = DEFAULT_MIN_RATIO,
  maxRatio: number = DEFAULT_MAX_RATIO,
  step: number = RATIO_STEP
): number | null {
  const bounds = normalizeBounds(minRatio, maxRatio);
  const current = clampRatio(currentRatio, bounds.minRatio, bounds.maxRatio);
  const safeStep = Number.isFinite(step) && step > 0 ? step : RATIO_STEP;

  switch (key) {
    case 'ArrowLeft':
      return clampRatio(
        roundRatio(current - safeStep),
        bounds.minRatio,
        bounds.maxRatio
      );
    case 'ArrowRight':
      return clampRatio(
        roundRatio(current + safeStep),
        bounds.minRatio,
        bounds.maxRatio
      );
    case 'Home':
      return bounds.minRatio;
    case 'End':
      return bounds.maxRatio;
    default:
      return null;
  }
}

/** Integer percentage used for the separator's ARIA value attributes. */
export function ratioToPercent(ratio: number): number {
  const clamped = clampRatio(ratio, 0, 1);
  return Math.round(clamped * 100);
}
