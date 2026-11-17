import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The shortcut hook is a window listener; effects do not run under
 * react-dom/server. As with tests/shortcutsGate.test.ts, assert the
 * source-level contract that matters:
 * - Ctrl+Shift+F / Ctrl+H sit after the modal `enabled` gate,
 * - the existing Ctrl+F CodeMirror search is not intercepted,
 * - the title bar exposes the optional entry point.
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');
}

describe('enhanced find & replace shortcut contract', () => {
  const source = readSource('src/hooks/useKeyboardShortcuts.ts');

  it('declares the optional onOpenSearch option', () => {
    expect(source).toContain('onOpenSearch?: () => void');
    expect(source).toContain('onOpenSearch,');
    expect(source).toContain('onOpenSearch?.()');
  });

  it('places Ctrl+Shift+F and Ctrl+H after the enabled gate', () => {
    const gateIndex = source.indexOf('if (!enabled) return;');
    const shiftFIndex = source.indexOf("e.key === 'f' || e.key === 'F'");
    const ctrlHIndex = source.indexOf("e.key === 'h' || e.key === 'H'");

    expect(gateIndex).toBeGreaterThan(-1);
    expect(shiftFIndex).toBeGreaterThan(gateIndex);
    expect(ctrlHIndex).toBeGreaterThan(gateIndex);
  });

  it('requires Shift for F and no Shift for H', () => {
    const shiftFIndex = source.indexOf("e.shiftKey && (e.key === 'f' || e.key === 'F')");
    const ctrlHIndex = source.indexOf(
      "!e.shiftKey && (e.key === 'h' || e.key === 'H')"
    );
    expect(shiftFIndex).toBeGreaterThan(-1);
    expect(ctrlHIndex).toBeGreaterThan(-1);
  });

  it('does not intercept plain Ctrl+F', () => {
    // The only Ctrl+F handling must be the Shift variant above. A plain
    // `!e.shiftKey && (e.key === 'f' ...)` branch would steal CodeMirror's
    // in-editor search panel.
    expect(source).not.toContain("!e.shiftKey && (e.key === 'f'");
    expect(source).not.toContain("e.key === 'f' || e.key === 'F') {\n          e.preventDefault();\n          onToggleShortcutsModal");
  });

  it('wires the title bar search icon', () => {
    const titleBar = readSource('src/components/TitleBar.tsx');
    expect(titleBar).toContain('onOpenSearch?: () => void');
    expect(titleBar).toContain('onClick={onOpenSearch}');
    expect(titleBar).toContain("t('search.tooltip')");
    expect(titleBar).toContain('<Search');
  });
});
