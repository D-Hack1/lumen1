// Owner: Nived
// Test helper: serve public/ files to the loaders through a stubbed fetch.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import refinedFixture from './fixtures/refined_parity.json';

export const PUBLIC = join(__dirname, '..', '..', '..', 'public');

export function stubFetch(): void {
  globalThis.fetch = (async (url: string) => {
    try {
      const buf = await readFile(join(PUBLIC, url));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => ab } as unknown as Response;
    } catch {
      return { ok: false, status: 404 } as unknown as Response;
    }
  }) as typeof fetch;
}

export async function readMock(rel: string): Promise<{ buf: ArrayBuffer; json: () => unknown }> {
  const b = await readFile(join(PUBLIC, 'data-mock', rel));
  return { buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, json: () => JSON.parse(b.toString()) };
}

/**
 * Demo-number oracle for IM-2, 30 days from the 2025-03-06 touchdown, from Gowri's Python with the CANONICAL method: refined-window durations
 * (G-10 final), not 2-minute sample counts. Golden Set 1 was generated with sample counts (IM-2 sunlit 49.2963 vs 49.2931 refined): its expectations
 * are to be versioned by Gowri, so engine tests that quote demo numbers use this until Golden Set 1 v2 exists.
 */
export const REFINED = Object.fromEntries((refinedFixture.cases as Array<{ name: string; metrics: Record<string, number> }>).map((c) => [c.name, c.metrics])) as Record<string, Record<string, number>>;
export const IM2_REFINED = REFINED.im2_athena;
