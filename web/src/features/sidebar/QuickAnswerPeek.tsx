// Owner: Abhinav
// Compact Quick Answer for a coordinate typed into the search (PLAN §8.4 / §8.5). Calls Nived's `useQuickAnswer`
// with the current landing time, duration and observer height; shows the answer in a Popover (emil: 150 ms,
// origin-aware) with "Open in Cockpit". The full Quick Answer modal (inputs, Copy as text, Export CSV) is
// features/quickAnswer/QuickAnswerCard (Phase 5) and will replace this peek's body.
import type { RefObject } from 'react';
import { fill, fmtBounded, fmtDeg, fmtUntil } from '../../engine/format';
import { useQuickAnswer } from '../../engine/hooks';
import type { EventRecord } from '../../engine/types';
import { useCopyFn } from '../../state/copy';
import { useScenario } from '../../state/scenarioStore';
import { Badge } from '../../ui/Badge';
import { Popover } from '../../ui/Popover';
import { fmtLatLon, type LatLon } from './siteModel';

const DAY = 86_400_000;

export interface QuickAnswerPeekProps {
  point: LatLon | null;
  anchor: RefObject<HTMLElement>;
  onClose(): void;
  onOpen(p: LatLon): void;
}

export function QuickAnswerPeek({ point, anchor, onClose, onOpen }: QuickAnswerPeekProps) {
  const t = useCopyFn();
  const landing = useScenario((s) => s.landingUtc + s.slipDays * DAY);
  const durationDays = useScenario((s) => s.durationDays);
  const heightM = useScenario((s) => s.heightM);
  const res = useQuickAnswer(point ? { lat: point.lat, lon: point.lon, utc: landing, durationDays, heightM } : null);
  const ev = (e: EventRecord | null) => (e ? fmtUntil(e.t - landing, e.dtMs, e.grazing) : '—');

  return (
    <Popover
      open={!!point}
      onClose={onClose}
      anchor={anchor}
      align="start"
      label={t('sb.quick.title')}
      className="sb-quick"
    >
      {point && (
        <div className="sb-quick__body" data-status={res.status}>
          <div className="sb-quick__head">
            <strong>{t('sb.quick.title')}</strong>
            <span className="num sb-quick__pt">{fmtLatLon(point)}</span>
            {res.tierBadge && (
              <Badge tone="tier" glyph={null}>
                {res.tierBadge}
              </Badge>
            )}
          </div>
          {res.status === 'loading' && <p className="sb-quick__muted">{t('sb.quick.loading')}</p>}
          {res.status === 'error' && (
            <p className="sb-quick__muted">{fill(t('sb.quick.error'), { e: res.error ?? '' })}</p>
          )}
          {res.status === 'ready' && (
            <dl className="sb-quick__grid">
              <dt>{t('answer.sunNow')}</dt>
              <dd className="num">
                {fmtDeg(res.sunElevDeg)} · {fill(t('answer.disk'), { n: Math.round(res.sunDiskPct) })} ·{' '}
                {res.sunUp ? t('answer.up') : t('answer.down')}
              </dd>
              <dt>{t('answer.earthNow')}</dt>
              <dd className="num">
                {fmtDeg(res.earthElevDeg)} · {res.linkUp ? t('answer.linkOk') : t('answer.linkDown')}
              </dd>
              <dt>{t('mb.jump.sunset.long')}</dt>
              <dd className="num">{ev(res.nextSunset)}</dd>
              <dt>{t('mb.jump.shadowExit.long')}</dt>
              <dd className="num">{ev(res.nextShadowExit)}</dd>
              <dt>{t('mb.jump.earthset.long')}</dt>
              <dd className="num">{ev(res.nextEarthset)}</dd>
              <dt>{t('answer.windowSunlit')}</dt>
              <dd className="num">{fmtBounded(res.sunlitPct, 0, '%')}</dd>
              <dt>{t('answer.windowLink')}</dt>
              <dd className="num">{fmtBounded(res.linkPct, 0, '%')}</dd>
              {res.psrDistanceKm != null && (
                <>
                  <dt>{t('metric.psr')}</dt>
                  <dd className="num">{res.psrDistanceKm.toFixed(1)} km</dd>
                </>
              )}
            </dl>
          )}
          <div className="sb-quick__foot">
            <button type="button" className="sb-btn" onClick={onClose}>
              {t('sb.quick.close')}
            </button>
            <button
              type="button"
              className="sb-btn sb-btn--primary"
              onClick={() => {
                onOpen(point);
                onClose();
              }}
            >
              {t('sb.quick.open')}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
