// Owner: Nived
// Seam: every CSS custom property the app REFERENCES (var(--x)) must be DEFINED, by the generated tokens or by some stylesheet.
// An undefined variable is silent: the declaration is dropped and the element falls back to transparent / inherited. This is how
// `var(--c-surface1)` (the generator emits --c-surface-1) left panels without backgrounds. Catches that whole class of bug.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenCss } from './tokens';

const SRC = join(__dirname, '..');
function files(dir: string, ext: string[]): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.some((e) => n.endsWith(e)) ? [p] : [];
  });
}

describe('CSS custom properties', () => {
  const sheets = files(SRC, ['.css']).map((f) => ({ f, css: readFileSync(f, 'utf8') }));
  const tsx = files(SRC, ['.tsx', '.ts']).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx') && !f.endsWith('tokens.ts')).map((f) => ({ f, css: readFileSync(f, 'utf8') }));
  const defined = new Set<string>();
  for (const m of buildTokenCss().matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  for (const { css } of [...sheets, ...tsx]) for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]); // declared locally (or set inline from TS)
  const undefinedRefs: Record<string, string[]> = {};
  for (const { f, css } of [...sheets, ...tsx]) {
    for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      if (!defined.has(m[1])) (undefinedRefs[m[1]] ??= []).push(f.replace(SRC + '/', ''));
    }
  }

  it('the generated tokens define the surface layers under the names the stylesheets use', () => {
    const css = buildTokenCss();
    for (const n of ['--c-surface1', '--c-surface2', '--c-surface3', '--c-surface4']) expect(css, n).toMatch(new RegExp(`${n}\\s*:`));
  });
  it('no stylesheet or component references an undefined variable', () => {
    const lines = Object.entries(undefinedRefs).map(([name, where]) => `${name}  (${[...new Set(where)].join(', ')})`);
    expect(lines, `undefined CSS variables:\n${lines.join('\n')}`).toEqual([]);
  });
});
