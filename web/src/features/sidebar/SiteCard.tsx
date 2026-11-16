// Owner: Abhinav
// Site card (PLAN §8.4, R3 D-12): category glyph · name · single tier badge · verdict dot; agency + category;
// lat/lon (longitude −180…180); touchdown UTC at its precision (historical) or "as published [date]" (targets);
// Landing vs Target coordinates when the catalog has both (Chandrayaan-3); Sun % and Link % sparklines over the
// scenario window (Ebin's Sparkline); "+ Compare".
// Interaction: click = select · Shift-click = add to Compare · hover = pulse the Basemap pin (siteHoverBus → CSS
// opacity, no React state). Press feedback is transform-only (emil); the list itself never animates while scrolling.
import { memo, type MouseEvent } from 'react';
import { fill } from '../../engine/format';
import type { SiteRecord, Sparkline as SparklineData, Verdict } from '../../engine/types';
import { Sparkline } from '../sparkline/Sparkline';
import { siteHoverBus } from '../../state/buses';
import { Badge } from '../../ui/Badge';
import { CATEGORY_GLYPH, fmtLatLon, fmtTouchdown, hasDistinctTarget, windowSlice } from './siteModel';

type T = (key: string) => string;

const VERDICT_GLYPH: Record<Verdict, string> = { GO: '●', MARGINAL: '◐', 'NO-GO': '✕', PENDING: '○' };
const VERDICT_CLASS: Record<Verdict, string> = { GO: 'go', MARGINAL: 'marginal', 'NO-GO': 'nogo', PENDING: 'pending' };

export interface SiteCardProps {
  site: SiteRecord;
  selected: boolean;
  /** Verdict when the engine has evaluated this site (selected site or a Compare row); null = not evaluated. */
  verdict: Verdict | null;
  sparkline: SparklineData | undefined;
  /** Effective landing (incl. slip) and window length, for the sparkline slice. */
  windowStartUtc: number;
  durationDays: number;
  t: T;
  onSelect(site: SiteRecord): void;
  onCompare(site: SiteRecord): void;
}

function Spark({
  data,
  tone,
  label,
  start,
  days,
  t,
  siteId,
}: {
  data: SparklineData | undefined;
  tone: 'sun' | 'earth';
  label: string;
  start: number;
  days: number;
  t: T;
  siteId: string;
}) {
  const series = data ? (tone === 'sun' ? data.sunlitPct : data.linkPct) : null;
  const range = series && data ? windowSlice(data.startUtc, series.length, start, days) : null;
  if (!series || !range) {
    return (
      <div className={`sb-spark sb-spark--${tone} is-empty`}>
        <span className="sb-spark__label">{label}</span>
        <span className="sb-spark__none">{t('sb.spark.none')}</span>
      </div>
    );
  }
  const values = series.subarray(range[0], range[1]);
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = Math.round(sum / values.length);
  return (
    <div className={`sb-spark sb-spark--${tone}`} title={fill(t('sb.spark.summary'), { label, n: mean })}>
      <span className="sb-spark__label">{label}</span>
      <div className="sb-spark__chart" aria-hidden="true">
        {/* keyed by window: the Sparkline's static layer only redraws when its length changes */}
        <Sparkline key={`${siteId}:${range[0]}:${range[1]}`} values={values} tone={tone} />
      </div>
      <span className="sb-spark__value num">{mean}%</span>
    </div>
  );
}

function SiteCardImpl({
  site,
  selected,
  verdict,
  sparkline,
  windowStartUtc,
  durationDays,
  t,
  onSelect,
  onCompare,
}: SiteCardProps) {
  const v: Verdict = verdict ?? 'PENDING';
  const tierText = site.tier === 'pending' ? t('sb.tier.pending') : fill(t('sb.tier'), { tier: site.tier });
  const hasTarget = hasDistinctTarget(site);
  const coordTitle = site.coordNote ?? undefined;
  const historical = site.category === 'historical_landing';
  const published = site.category === 'published_target';

  const select = (e: MouseEvent) => {
    if (e.shiftKey) onCompare(site);
    else onSelect(site);
  };

  return (
    <article
      className={['sb-card', selected && 'is-selected'].filter(Boolean).join(' ')}
      data-site={site.id}
      data-category={site.category}
      onPointerEnter={() => siteHoverBus.set({ siteId: site.id })}
      onPointerLeave={() => siteHoverBus.get().siteId === site.id && siteHoverBus.set({ siteId: null })}
    >
      <div className="sb-card__top">
        <span className={`sb-card__glyph sb-card__glyph--${site.category}`} aria-hidden="true">
          {CATEGORY_GLYPH[site.category]}
        </span>
        <button
          type="button"
          className="sb-card__name truncate"
          aria-pressed={selected}
          title={`${site.name} — ${t('sb.card.hint')}`}
          onClick={select}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              onCompare(site);
            }
          }}
        >
          {site.name}
        </button>
        <Badge
          tone="tier"
          glyph={null}
          className="sb-card__tier"
          title={site.tier === 'pending' ? t('sb.tier.pending.long') : site.sigmaSource}
        >
          {tierText}
        </Badge>
        <span
          className={`sb-card__verdict sb-card__verdict--${VERDICT_CLASS[v]}`}
          title={verdict ? fill(t('sb.verdict.of'), { v: t(`verdict.${v}`) }) : t('sb.verdict.pending')}
          data-verdict={v}
        >
          <span aria-hidden="true">{VERDICT_GLYPH[v]}</span>
          <span className="sr-only">
            {verdict ? fill(t('sb.verdict.of'), { v: t(`verdict.${v}`) }) : t('sb.verdict.pending')}
          </span>
        </span>
      </div>

      <div className="sb-card__meta truncate">
        {site.agency && <span>{site.agency}</span>}
        <span>{t(`sb.category.${site.category}`)}</span>
        {site.mock && <span className="sb-card__mock">{t('sb.mock')}</span>}
      </div>

      {hasTarget ? (
        <div className="sb-card__coords num" data-coords="landing-target" title={coordTitle}>
          <span className="truncate">
            <span className="sb-card__k">{t('sb.landing')}</span> {fmtLatLon(site.landingCoords)}
          </span>
          <span className="truncate">
            <span className="sb-card__k">{t('sb.target')}</span> {fmtLatLon(site.targetCoords!)}
          </span>
        </div>
      ) : (
        <div className="sb-card__coords num truncate" data-coords="single" title={coordTitle}>
          {fmtLatLon(site.landingCoords ?? site)}
        </div>
      )}

      {historical && site.touchdownUtc != null && (
        <div className="sb-card__date truncate" data-date="touchdown">
          <span className="num">
            {fill(t('sb.touchdown'), { time: fmtTouchdown(site.touchdownUtc, site.touchdownPrecision) })}
          </span>
          {site.touchdownPrecision && (
            <span className="sb-card__faint"> · {t(`sb.precision.${site.touchdownPrecision}`)}</span>
          )}
        </div>
      )}
      {published && (
        <div className="sb-card__date truncate" data-date="published">
          {site.asPublishedDate ? (
            <span className="num">{fill(t('sb.asPublished'), { date: site.asPublishedDate })}</span>
          ) : (
            <span className="sb-card__faint">{t('sb.asPublished.pending')}</span>
          )}
        </div>
      )}

      <div className="sb-card__foot">
        <Spark
          data={sparkline}
          tone="sun"
          label={t('sb.spark.sun')}
          start={windowStartUtc}
          days={durationDays}
          t={t}
          siteId={site.id}
        />
        <Spark
          data={sparkline}
          tone="earth"
          label={t('sb.spark.link')}
          start={windowStartUtc}
          days={durationDays}
          t={t}
          siteId={site.id}
        />
        <button
          type="button"
          className="sb-card__compare"
          title={t('sb.compare.long')}
          onClick={(e) => {
            e.stopPropagation();
            onCompare(site);
          }}
        >
          {t('sb.compare')}
        </button>
      </div>
    </article>
  );
}

export const SiteCard = memo(SiteCardImpl);
