// Owner: Abhinav
// Mission Profile form (PLAN §8.6 left column; same fields in compact form in the Cockpit Profile & Battery overlay).
// Fields: surface duration, min sunlit %, min link hours, max longest night (h), max pad slope (°), battery Wh,
// usable depth of discharge %, load W. Every input shows its unit; invalid input is flagged in place (aria-invalid +
// message) and never reaches the store. Valid edits are committed to the scenario store debounced 150 ms after the
// last keystroke (one recompute per pause, not per key); Enter / blur commits immediately. External store changes
// (URL, Quick-Start, the other form) resync fields that are not being edited.
import { useEffect, useId, useRef, useState } from 'react';
import { fill } from '../../engine/format';
import type { Bounded, ScenarioResult } from '../../engine/types';
import { useCopyFn } from '../../state/copy';
import { getScenario, useScenario, type ProfileThresholds } from '../../state/scenarioStore';
import { BatteryLine } from './BatteryLine';
import { RequirementList } from './RequirementList';
import {
  FIELD,
  PROFILE_FIELDS,
  crossFieldErrors,
  fmtNum,
  parseField,
  profileSummary,
  type FieldError,
  type ProfileKey,
} from './profileModel';
import './scenarios.css';

export const PROFILE_DEBOUNCE_MS = 150;

type Raw = Record<ProfileKey, string>;
const toRaw = (p: ProfileThresholds): Raw =>
  Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, String(p[f.key])])) as Raw;

export interface MissionProfileFormProps {
  /** 'full' = Compare left column; 'compact' = Cockpit Profile & Battery overlay. */
  variant?: 'full' | 'compact';
  /** Longest night (bounded) the battery check runs against: the selected row (Compare) or the Cockpit result. */
  longestNightH?: Bounded | null;
  /** Caption naming whose longest night the battery line uses (e.g. "row B"). */
  nightSource?: string;
  /** Full variant: the result the requirement list judges (the selected Compare row). */
  result?: Pick<ScenarioResult, 'metrics' | 'meta'> | null;
}

export function MissionProfileForm({ variant = 'full', longestNightH = null, nightSource, result = null }: MissionProfileFormProps) {
  const t = useCopyFn();
  const uid = useId();
  const profile = useScenario((s) => s.profile);
  const [raw, setRaw] = useState<Raw>(() => toRaw(profile));
  const [errors, setErrors] = useState<Partial<Record<ProfileKey, FieldError>>>({});
  const editing = useRef<ProfileKey | null>(null);
  const pending = useRef<Partial<ProfileThresholds>>({});
  const timer = useRef<number | undefined>(undefined);

  // Resync from the store (fields not under the cursor).
  useEffect(() => {
    setRaw((r) => {
      const next = { ...r };
      for (const f of PROFILE_FIELDS) {
        if (f.key === editing.current || f.key in pending.current) continue;
        next[f.key] = String(profile[f.key]);
      }
      return next;
    });
  }, [profile]);

  const flush = () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) getScenario().setProfile(patch);
  };
  useEffect(() => () => flush(), []); // commit anything pending on unmount (e.g. the overlay closes mid-edit)

  const onChange = (key: ProfileKey, value: string) => {
    const nextRaw = { ...raw, [key]: value };
    setRaw(nextRaw);
    // validate every field (cross-field rules depend on the others)
    const errs: Partial<Record<ProfileKey, FieldError>> = {};
    const cand = { ...getScenario().profile };
    for (const f of PROFILE_FIELDS) {
      const r = parseField(f.key, nextRaw[f.key]);
      if ('error' in r) errs[f.key] = r.error;
      else cand[f.key] = r.value;
    }
    Object.assign(errs, Object.fromEntries(Object.entries(crossFieldErrors(cand)).filter(([k]) => !errs[k as ProfileKey])));
    setErrors(errs);
    window.clearTimeout(timer.current);
    if (Object.keys(errs).length) {
      pending.current = {};
      return; // nothing invalid ever reaches the store
    }
    const cur = getScenario().profile;
    const patch: Partial<ProfileThresholds> = {};
    for (const f of PROFILE_FIELDS) if (cand[f.key] !== cur[f.key]) patch[f.key] = cand[f.key];
    pending.current = patch;
    timer.current = window.setTimeout(flush, PROFILE_DEBOUNCE_MS);
  };

  const errText = (key: ProfileKey, e: FieldError) => {
    const f = FIELD[key];
    return fill(t(e), { min: fmtNum(f.min), max: fmtNum(f.max), unit: f.unit, h: fmtNum(getScenario().profile.surfaceDurationDays * 24) });
  };
  const firstError = PROFILE_FIELDS.find((f) => errors[f.key]);

  return (
    <form
      className={`mp-form mp-form--${variant}`}
      onSubmit={(e) => {
        e.preventDefault();
        flush();
      }}
      noValidate
      aria-label={t('profile.title')}
    >
      {variant === 'full' && (
        <div className="mp-form__head">
          <span className="mp-form__title">{t('profile.title')}</span>
          <span className="mp-form__hint truncate">{t('profile.form.hint')}</span>
        </div>
      )}
      <div className="mp-form__grid">
        {PROFILE_FIELDS.map((f) => {
          const id = `${uid}-${f.key}`;
          const err = errors[f.key];
          return (
            <label key={f.key} className="mp-field" htmlFor={id} data-invalid={err ? '' : undefined}>
              <span className="mp-field__label truncate" title={t(`profile.${f.key}.long`)}>
                {f.op && <span className="mp-field__op">{f.op}</span>}
                {t(`profile.${f.key}`)}
              </span>
              <span className="mp-field__box">
                <input
                  id={id}
                  className="mp-field__input num"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={raw[f.key]}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `${id}-err` : undefined}
                  title={err ? errText(f.key, err) : `${fmtNum(f.min)}–${fmtNum(f.max)} ${f.unit}`}
                  onFocus={() => (editing.current = f.key)}
                  onBlur={() => {
                    editing.current = null;
                    flush();
                  }}
                  onChange={(e) => onChange(f.key, e.currentTarget.value)}
                />
                <span className="mp-field__unit">{f.unit}</span>
              </span>
              {err && (
                <span id={`${id}-err`} className="sr-only">
                  {errText(f.key, err)}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="mp-form__status" role="status" aria-live="polite">
        {firstError ? (
          <span className="mp-form__error truncate">
            {t(`profile.${firstError.key}`)}: {errText(firstError.key, errors[firstError.key]!)}
          </span>
        ) : (
          <span className="mp-form__summary truncate num" title={profileSummary(profile, t)} data-testid="profile-summary">
            {profileSummary(profile, t)}
          </span>
        )}
      </div>
      <BatteryLine profile={profile} longestNightH={longestNightH} source={nightSource} compact={variant === 'compact'} />
      {variant === 'full' && (
        <div className="mp-form__reqs" data-testid="profile-requirements">
          <div className="mp-summary__section">
            {t('profile.req.title')}
            {nightSource ? ` · ${nightSource}` : ''}
          </div>
          <RequirementList result={result} compact />
        </div>
      )}
    </form>
  );
}
