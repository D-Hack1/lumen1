// Owner: Abhinav
// Persistent Top Mission Bar (PLAN §8.2).
// Phase 1: brand + site + tier, view tabs, landing UTC + duration + MET readout, persona switch, Share URL + toast.
// Phase 2: jump buttons S/E/X/T calling the engine's jumpTo (instant scrub, no tween) with a dynamic E label
//   (Next Earthrise when Earth is down, Next Earthset when up, from the engine answer state, R3 D-14), tooltips
//   with target time ±, disabled state when there is no event before the window ends, keyboard S/E/X/T;
//   verdict chip with 120 ms crossfade + Mission Profile popover.
// Phase 5: Quick Answer, Quick-Start, Help buttons; full keyboard map (1/2/3, Q, arrows, Space).
import { useEffect, useRef, useState } from 'react';
import { jumpTo, useCatalog, useResult } from '../engine/hooks';
import type { AnswerState, EventRecord, Verdict } from '../engine/types';
import { forcedAnswerFromUrl, WORST_CASE_ANSWER } from '../mocks/forced';
import { crosshairBus } from '../state/buses';
import { useCopyFn } from '../state/copy';
import { crosshair } from '../state/crosshairStore';
import { getScenario, useScenario, type DurationDays, type Persona, type ViewId } from '../state/scenarioStore';
import { scenarioUrl } from '../state/urlSync';
import { Badge } from '../ui/Badge';
import { Segmented } from '../ui/Segmented';
import { toast } from '../ui/Toast';
import { Tooltip } from '../ui/Tooltip';
import { JUMP_SLOTS, jumpSlotForKey, jumpTooltip, resolveJump, type JumpTarget } from './jumps';
import { useFixture } from './layout/fixture';
import { formatMet, formatUtc, parseUtc } from './time';
import { chipFromResult, forcedChipFromUrl, type ChipState } from './verdict';
import { VerdictChip } from './VerdictChip';

const VIEWS: ViewId[] = ['cockpit', 'compare', 'methodology'];
const DURATIONS: DurationDays[] = [7, 14, 30, 60];
// ---------- pieces ----------

function LandingInput() {
  const landingUtc = useScenario((s) => s.landingUtc);
  const setLandingUtc = useScenario((s) => s.setLandingUtc);
  const t = useCopyFn();
  const [draft, setDraft] = useState(formatUtc(landingUtc));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(formatUtc(landingUtc));
    setInvalid(false);
  }, [landingUtc]);

  const commit = () => {
    const v = parseUtc(draft);
    if (v == null) return setInvalid(true);
    setInvalid(false);
    if (v !== landingUtc) setLandingUtc(v);
    else setDraft(formatUtc(v));
  };
  return (
    <label className="mb-field" title={t('mb.landing.long')}>
      <span className="mb-field__label mb-long">{t('mb.landing')}</span>
      <input
        className="mb-input num"
        value={draft}
        spellCheck={false}
        inputMode="numeric"
        aria-label={t('mb.landing.long')}
        aria-invalid={invalid || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(formatUtc(landingUtc));
            setInvalid(false);
          }
        }}
      />
      <span className="mb-field__unit">UTC</span>
    </label>
  );
}

/** MET of the live scrub time — Fast Lane: bus subscriber writes textContent, never React state. */
function MetReadout() {
  const t = useCopyFn();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const draw = () => {
      if (ref.current) ref.current.textContent = formatMet(crosshairBus.get().tScrub, getScenario().landingUtc);
    };
    draw();
    const a = crosshairBus.subscribe(draw);
    const b = useScenario.subscribe((s, p) => s.landingUtc !== p.landingUtc && draw());
    return () => {
      a();
      b();
    };
  }, []);
  return (
    <span className="mb-met" title={t('mb.met')}>
      <span className="mb-field__label mb-long">{t('mb.met')}</span>
      <span ref={ref} className="mb-met__value num" data-hotpath="" aria-live="off" />
    </span>
  );
}

export interface JumpButtonsProps {
  answer: AnswerState | null;
  events: EventRecord[];
  /** Listen for S/E/X/T on the window (off for secondary renders and tests). */
  keyboard?: boolean;
}

/** Jump buttons S / E / X / T. Targets come from the engine; the scrub is committed instantly (no tween, §1.4). */
export function JumpButtons({ answer, events, keyboard = true }: JumpButtonsProps) {
  const t = useCopyFn();
  const scrubUtc = useScenario((s) => s.scrubUtc); // committed scrub (human rate) so targets stay "next"
  const landingUtc = useScenario((s) => s.landingUtc);
  const targets = JUMP_SLOTS.map((slot) => resolveJump(slot, { answer, events, scrubUtc, landingUtc, jumpTo }));

  const go = (j: JumpTarget) => {
    if (j.t == null) return toast(t('mb.jump.none'));
    crosshair.commitScrub(j.t); // instant: t_scrub is never tweened
  };
  const latest = useRef({ answer, events, go });
  latest.current = { answer, events, go };

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const slot = jumpSlotForKey(e);
      if (!slot) return;
      e.preventDefault();
      const s = getScenario(); // read at key time, not at the last render
      const { answer: a, events: ev, go: g } = latest.current;
      g(resolveJump(slot, { answer: a, events: ev, scrubUtc: s.scrubUtc, landingUtc: s.landingUtc, jumpTo }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard]);

  return (
    <div className="mb-jumps" role="group" aria-label={t('mb.jump.group')}>
      {targets.map((j) => (
        <Tooltip key={j.slot} content={jumpTooltip(j, t)}>
          <button
            type="button"
            className="mb-btn mb-jump"
            data-jump={j.slot}
            data-event={j.id}
            aria-label={t(`mb.jump.${j.id}.long`)}
            aria-keyshortcuts={j.slot}
            aria-disabled={j.t == null || undefined}
            onClick={() => go(j)}
          >
            <kbd className="mb-kbd">{j.slot}</kbd>
            <span className="mb-jump__label mb-mid">{t(`mb.jump.${j.id}`)}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** Same answer source as the Answer Strip: worst-case fixture, then `?answerState=`, then the live engine result. */
function useBarAnswer(live: AnswerState | null): AnswerState | null {
  const worst = useFixture()?.name === 'worst-case';
  return worst ? WORST_CASE_ANSWER : (forcedAnswerFromUrl() ?? live);
}

/** Remember the last settled verdict so a recompute shows it as provisional instead of flashing PENDING. */
function useChipState(
  status: 'idle' | 'loading' | 'ready' | 'error',
  verdict: Verdict,
  forced: ChipState | null,
): ChipState {
  const settled = useRef<Verdict | null>(null);
  const chip = chipFromResult({ status, verdict }, settled.current);
  useEffect(() => {
    if (status === 'ready') settled.current = verdict;
  }, [status, verdict]);
  return forced ?? chip;
}

// ---------- bar ----------

export function MissionBar() {
  const t = useCopyFn();
  const view = useScenario((s) => s.view);
  const setView = useScenario((s) => s.setView);
  const persona = useScenario((s) => s.persona);
  const setPersona = useScenario((s) => s.setPersona);
  const duration = useScenario((s) => s.durationDays);
  const setDuration = useScenario((s) => s.setDuration);
  const site = useScenario((s) => s.site);
  const { sites } = useCatalog();
  const result = useResult();
  const fx = useFixture()?.missionBar;

  const rec = site.kind === 'site' ? sites.find((s) => s.id === site.id) : undefined;
  const siteLabel =
    fx?.siteLabel ??
    (site.kind === 'point' ? `${site.lat.toFixed(3)}°, ${site.lon.toFixed(3)}°` : (rec?.name ?? site.id));
  const tier = fx?.tierLabel ?? (rec ? `Tier ${rec.tier}` : site.kind === 'point' ? 'Tier B/C' : 'Tier –');
  const answer = useBarAnswer(result.answer);
  const fxChip: ChipState | null = fx?.verdict ? { verdict: fx.verdict, provisional: !!fx.provisional } : null;
  const chip = useChipState(result.status, result.verdict, fxChip ?? forcedChipFromUrl());

  const share = async () => {
    const url = scenarioUrl();
    try {
      await navigator.clipboard.writeText(url);
      toast(t('mb.share.toast'), { tone: 'success' });
    } catch {
      window.history.replaceState(null, '', url);
      toast(t('mb.share.failed'));
    }
  };

  return (
    <header className="mission-bar" data-region="mission-bar">
      <div className="mb-brand">
        <span className="mb-logo" title={t('app.tagline')}>
          {t('app.name')}
        </span>
        <span className="mb-site truncate" title={siteLabel}>
          {siteLabel}
        </span>
        <Badge tone="tier" glyph={null}>
          {tier}
        </Badge>
      </div>

      <Segmented<ViewId>
        as="tabs"
        ariaLabel="Views"
        value={view}
        onChange={setView}
        options={VIEWS.map((v) => ({ value: v, label: t(`view.${v}`), title: t(`view.${v}.long`) }))}
      />

      <div className="mb-time">
        <LandingInput />
        <Segmented<DurationDays>
          size="sm"
          ariaLabel={t('mb.duration')}
          value={duration}
          onChange={setDuration}
          options={DURATIONS.map((d) => ({ value: d, label: `${d}d`, title: `${d} days` }))}
        />
        <MetReadout />
      </div>

      <JumpButtons answer={answer} events={result.events} />

      <div className="mb-end">
        <VerdictChip state={chip} reasons={result.verdictReasons} />
        <Segmented<Persona>
          size="sm"
          ariaLabel={t('mb.persona')}
          value={persona}
          onChange={setPersona}
          options={(['planner', 'educator'] as const).map((p) => ({
            value: p,
            label: t(`persona.${p}`),
            title: t(`persona.${p}.long`),
          }))}
        />
        <button type="button" className="mb-btn mb-share" onClick={share} title={t('mb.share.long')}>
          <span aria-hidden="true">⤴</span>
          <span className="mb-mid">{t('mb.share')}</span>
        </button>
      </div>
    </header>
  );
}
