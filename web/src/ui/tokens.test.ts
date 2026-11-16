// Owner: Abhinav — every CSS custom property used in any stylesheet must be defined (by tokens.ts or a stylesheet).
// Guards the Phase 1 bug where the generator emitted `--c-surface-2` while CSS used `var(--c-surface2)` (transparent
// panels/popovers). Covers all of src/ (teammates' CSS too) so an undefined token is caught before it ships.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenCss, kebab } from './tokens';

const SRC = join(__dirname, '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? cssFiles(p) : f.endsWith('.css') ? [p] : [];
  });
}

describe('design tokens → CSS variables', () => {
  it('kebab keeps digits attached', () => {
    expect(kebab('surface2')).toBe('surface2');
    expect(kebab('textOnAccent')).toBe('text-on-accent');
    expect(kebab('durPopover')).toBe('dur-popover');
    expect(kebab('2xs')).toBe('2xs');
  });

  it('every var(--x) used in src/**/*.css is defined', () => {
    const files = cssFiles(SRC);
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n') + buildTokenCss();
    const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const missing: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) {
        if (!defined.has(m[1]) && !m[2]) missing.push(`${relative(SRC, f)}: ${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('the four surfaces exist with their palette values', () => {
    const css = buildTokenCss();
    for (const k of ['surface1', 'surface2', 'surface3', 'surface4']) expect(css).toMatch(new RegExp(`--c-${k}: #`));
  });
});
