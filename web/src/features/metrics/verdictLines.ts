// Owner: Nived
// Plain-language text for the verdict block: a headline per verdict and the engine's reasons, capped so the panel stays calm.
// Pure (verdict, reasons, copy fn) -> { headline, lines }.
import type { Verdict } from '../../engine/types';
import { fill } from '../../engine/format';

export const MAX_REASON_LINES = 4;

export function verdictLines(verdict: Verdict, reasons: string[], t: (key: string) => string): { headline: string; lines: string[] } {
  const clean = reasons.map((r) => r.trim()).filter(Boolean);
  const shown = clean.slice(0, MAX_REASON_LINES);
  const extra = clean.length - shown.length;
  return { headline: t(`verdict.headline.${verdict}`), lines: extra > 0 ? [...shown, fill(t('metric.more'), { n: extra })] : shown };
}
