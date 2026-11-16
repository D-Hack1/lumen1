// Owner: Ebin
// Season Strip (MVP): 12 monthly cells of sunlit % and link % for the chosen year (PLAN_FINAL §8.6), folded from
// the daily sparkline series (P12). Two rows — Sun (amber, solid bar) and Earth link (blue, dotted bar) — every
// cell carries its number, so nothing relies on colour. Year defaults to the scenario's landing year.
import { useMemo, useState } from 'react';
import { useCatalog } from '../../engine/hooks';
import { useScenario } from '../../state/scenarioStore';
import { cssStateFill } from '../../ui/patterns';
import { Chip } from '../../ui/Chip';
import { color } from '../../ui/tokens';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const DAY = 86_400_000;

/** Monthly mean of a daily percent series, for one UTC year. NaN where the series has no day in that month. */
function monthlyMeans(startUtc: number, daily: ArrayLike<number>, year: number): number[] {
  const sum = new Array<number>(12).fill(0);
  const cnt = new Array<number>(12).fill(0);
  for (let i = 0; i < daily.length; i++) {
    const d = new Date(startUtc + i * DAY);
    if (d.getUTCFullYear() !== year) continue;
    const m = d.getUTCMonth();
    sum[m] += daily[i];
    cnt[m]++;
  }
  return sum.map((s, m) => (cnt[m] ? s / cnt[m] : NaN));
}

function Row({ label, values, fill }: { label: string; values: number[]; fill: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 2, flex: 1, minHeight: 0 }}>
      <span style={{ width: 34, fontSize: 'var(--fs-2xs)', color: color.textMuted, alignSelf: 'center' }}>{label}</span>
      {values.map((v, m) => (
        <div
          key={m}
          title={Number.isNaN(v) ? 'no data' : `${v.toFixed(0)} %`}
          style={{ flex: 1, position: 'relative', background: color.surface2, minWidth: 0 }}
        >
          {!Number.isNaN(v) && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${v}%`, background: fill }} />}
          <span className="num" style={{ position: 'absolute', top: 1, left: 0, right: 0, textAlign: 'center', fontSize: 'var(--fs-2xs)', color: color.text, textShadow: `0 0 3px ${color.bg}` }}>
            {Number.isNaN(v) ? '—' : v.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SeasonStrip() {
  const catalog = useCatalog();
  const site = useScenario((s) => s.site);
  const landingUtc = useScenario((s) => s.landingUtc);
  const siteId = site.kind === 'site' ? site.id : null;
  const spark = siteId ? catalog.sparklines[siteId] : null;

  const [yearOverride, setYear] = useState<number | null>(null);
  const first = spark ? new Date(spark.startUtc).getUTCFullYear() : 0;
  const last = spark ? new Date(spark.startUtc + (spark.sunlitPct.length - 1) * DAY).getUTCFullYear() : 0;
  const landingYear = new Date(landingUtc).getUTCFullYear();
  const year = Math.min(last, Math.max(first, yearOverride ?? landingYear));

  const sun = useMemo(() => (spark ? monthlyMeans(spark.startUtc, spark.sunlitPct, year) : []), [spark, year]);
  const link = useMemo(() => (spark ? monthlyMeans(spark.startUtc, spark.linkPct, year) : []), [spark, year]);

  if (!spark) return <div style={{ color: color.textFaint, fontSize: 'var(--fs-sm)' }}>No seasonal data for this site or point yet.</div>;

  return (
    <div className="season-strip" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <Chip aria-label="Previous year" disabled={year <= first} onClick={() => setYear(year - 1)}>◀</Chip>
        <span className="num" style={{ minWidth: 36, textAlign: 'center' }}>{year}</span>
        <Chip aria-label="Next year" disabled={year >= last} onClick={() => setYear(year + 1)}>▶</Chip>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: color.textFaint }}>monthly mean % · default definitions</span>
      </div>
      <Row label="Sunlit" values={sun} fill={cssStateFill('sun')} />
      <Row label="Link" values={link} fill={color.earth} />
      <div style={{ display: 'flex', gap: 2, paddingLeft: 36 }}>
        {MONTHS.map((m, i) => (
          <span key={i} className="num" style={{ flex: 1, textAlign: 'center', fontSize: 'var(--fs-2xs)', color: color.textFaint }}>{m}</span>
        ))}
      </div>
    </div>
  );
}
