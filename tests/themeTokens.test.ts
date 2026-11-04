import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..');

describe('semantic theme tokens', () => {
  it('defines semantic surfaces in Tailwind and light/dark CSS variables', () => {
    const config = readFileSync(resolve(root, 'tailwind.config.js'), 'utf-8');
    const css = readFileSync(resolve(root, 'src/styles/index.css'), 'utf-8');

    for (const token of ['app', 'chrome', 'panel', 'workspace', 'elevated']) {
      expect(config).toContain(`${token}: "rgb(var(`);
    }
    expect(css).toContain(':root {');
    expect(css).toContain('.dark {');
    expect(css).toContain('--color-bg-app:');
    expect(css).toContain('--color-bg-elevated:');
  });

  it('keeps hard-coded arbitrary dark surface backgrounds out of components', () => {
    const componentsDir = resolve(root, 'src/components');
    const offenders: string[] = [];
    for (const name of readdirSync(componentsDir)) {
      if (!name.endsWith('.tsx')) continue;
      const source = readFileSync(resolve(componentsDir, name), 'utf-8');
      if (/dark:bg-\[#[0-9a-f]{6}\]/i.test(source)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
