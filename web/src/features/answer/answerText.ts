// Owner: Nived
// Answer Strip text for each D-14 state. Pure: (state, copy fn) -> string. Kept out of the component file so the
// component module only exports a component (fast refresh) and tests can call these directly.
import { fill, fmtSpan, fmtUntil } from '../../engine/format';
import type { AnswerState } from '../../engine/types';

type T = (key: string) => string;

function countdown(a: { nextEventT: number | null; nextEventPmMs: number | null; grazing: boolean }, tScrub: number, t: T): string | null {
  if (a.nextEventT == null) return null;
  const s = fmtUntil(Math.max(0, a.nextEventT - tScrub), a.nextEventPmMs, a.grazing);
  return a.grazing ? fill(t('answer.grazing'), { t: s }) : s;
}

export function sunEventText(a: AnswerState, t: T, windowDays: number): string {
  const s = a.sun;
  const when = countdown(s, a.tScrub, t);
  switch (s.state) {
    case 'sunsetIn':
      return fill(t('answer.sun.sunsetIn'), { t: when ?? '' });
    case 'sunriseIn': {
      const main = fill(t('answer.sun.sunriseIn'), { t: when ?? '' });
      return s.darkForMs != null ? `${main} · ${fill(t('answer.sun.darkFor'), { t: fmtSpan(s.darkForMs) })}` : main;
    }
    case 'noSunriseBeforeEnd': {
      const main = fill(t('answer.sun.noSunriseBeforeEnd'), { n: windowDays });
      return s.darkForMs != null ? `${main} · ${fill(t('answer.sun.darkFor'), { t: fmtSpan(s.darkForMs) })}` : main;
    }
    case 'staysUpPastEnd':
      return t('answer.sun.staysUpPastEnd');
    case 'belowOpsElevation':
      return when
        ? fill(t('answer.sun.belowOps'), { deg: s.opsMinElevDeg ?? 0, t: when })
        : fill(t('answer.sun.belowOpsNoResume'), { deg: s.opsMinElevDeg ?? 0 });
  }
}

export function earthEventText(a: AnswerState, t: T): string {
  const e = a.earth;
  const when = countdown(e, a.tScrub, t);
  if (when == null) return t('answer.earth.noChange');
  const key = e.state === 'linkResumesDsn' ? 'answer.earth.linkResumes' : e.state === 'earthriseIn' ? 'answer.earth.earthriseIn' : 'answer.earth.earthsetIn';
  return fill(t(key), { t: when });
}

