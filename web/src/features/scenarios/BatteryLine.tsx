// Owner: Abhinav
// Battery verdict line (PLAN §5.6 Tier 1: endurance = battery Wh × usable DoD ÷ load W vs longest night).
// "Survives longest night ✓ with X h margin" / "Short of the longest night ✗ by X h" — checked against the longest
// night's conservative (upper) bound when the engine gives one. Glyph + text, never colour alone. Advisory: the
// engine verdict does not include the battery yet (reported to Nived).
import { fill } from '../../engine/format';
import type { Bounded } from '../../engine/types';
import { useCopyFn } from '../../state/copy';
import type { ProfileThresholds } from '../../state/scenarioStore';
import { batteryCheck, fmtNum } from './profileModel';
import { batteryHeadline } from './rowModel';

/** Copy carries its own ✓/✗ ("Survives longest night ✓ with …"): colour that glyph in place. Text without one
 *  (the "waits for data" state) gets the status glyph in front. */
export function GlyphText({ text, glyph }: { text: string; glyph: string }) {
  const parts = text.split(/([✓✗])/);
  if (parts.length === 1)
    return (
      <>
        <span className="bat-glyph">{glyph}</span> {text}
      </>
    );
  return (
    <>
      {parts.map((p, i) =>
        p === '✓' || p === '✗' ? (
          <span key={i} className="bat-glyph">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

export interface BatteryLineProps {
  profile: ProfileThresholds;
  longestNightH: Bounded | null | undefined;
  source?: string;
  compact?: boolean;
}

export function BatteryLine({ profile, longestNightH, source, compact }: BatteryLineProps) {
  const t = useCopyFn();
  const b = batteryCheck(profile, longestNightH);
  const { glyph, text } = batteryHeadline(b, t);
  const detail = [
    fill(t('battery.endurance'), { h: fmtNum(b.enduranceH, 1) }),
    b.nightH != null &&
      fill(t('battery.night'), {
        h: fmtNum(b.nightH, 1),
        bound: t(b.nightBound === 'conservative' ? 'battery.bound.conservative' : 'battery.bound.nominal'),
      }),
    source,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="bat-line" data-status={b.status} data-compact={compact || undefined} data-testid="battery-line">
      <span className="bat-line__text truncate" title={`${text} — ${detail}`}>
        <span className="bat-line__head">
          <GlyphText text={text} glyph={glyph} />
        </span>
        <span className="bat-line__detail num"> · {detail}</span>
      </span>
      <span className="bat-line__adv" title={t('battery.advisory.long')}>
        {t('battery.advisory')}
      </span>
    </div>
  );
}
