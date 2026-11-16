// Owner: Ebin
// Guards against a stale knowledge file: public/content/knowledge.json is BUILT from the glossary, docs/validation.md,
// docs/limitations.md, docs/ask_help.md and the plan's decision log. If any of those change and the builder isn't re-run,
// the app would keep answering from old text. This rebuilds into a temp file and compares.
// To fix a failure:  cd web && node scripts/build-knowledge.mjs   (then commit public/content/knowledge.json)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('knowledge.json is up to date with its sources', () => {
  it('rebuilding from the sources gives exactly the committed file', () => {
    const web = resolve(__dirname, '../../..');
    const dir = mkdtempSync(join(tmpdir(), 'lumen-knowledge-'));
    const out = join(dir, 'knowledge.json');
    try {
      execFileSync(process.execPath, [join(web, 'scripts/build-knowledge.mjs')], { env: { ...process.env, KNOWLEDGE_OUT: out }, stdio: 'pipe' });
      const rebuilt = readFileSync(out, 'utf8').replace(/\r\n/g, '\n');
      const committed = readFileSync(join(web, 'public/content/knowledge.json'), 'utf8').replace(/\r\n/g, '\n');
      expect(rebuilt, 'knowledge.json is stale — run: cd web && node scripts/build-knowledge.mjs').toBe(committed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
