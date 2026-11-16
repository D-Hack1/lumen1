// Owner: Abhinav
// ✎ popover body: edits every definition the engine uses (PLAN §8.3, §5.5; R3 D-10) and the one-click
// "ISRO Vikram ops (min Sun elevation 6°)" preset. Sliders are native and uncontrolled: the value readout follows the
// thumb via a ref (no React state at pointer rate) and the store is written once on release → one recompute.
import { useRef, type ReactNode } from 'react';
import { useCopyFn } from '../../state/copy';
import { getScenario, useScenario, type Definitions, type DsnMode, type MastHeightM } from '../../state/scenarioStore';
import { InfoBadge } from '../../ui/InfoBadge';
import { Segmented } from '../../ui/Segmented';
import { Slider } from '../../ui/Slider';

const HEIGHTS: MastHeightM[] = [1, 2, 5, 10];

function Field({
  label,
  term,
  help,
  value,
  children,
}: {
  label: string;
  term: string;
  help: string;
  value?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="def-field">
      <div className="def-field__head">
        <span className="def-field__label">
          {label} <InfoBadge term={term} label={label} />
        </span>
        {value}
      </div>
      {children}
      <p className="def-field__help">{help}</p>
    </div>
  );
}

interface SliderFieldProps {
  k: keyof Pick<
    Definitions,
    'sunDiskThresholdPct' | 'earthMarginDeg' | 'dteDiskThresholdPct' | 'dsnMaskDeg' | 'minSunElevationOps'
  >;
  label: string;
  term: string;
  help: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  disabled?: boolean;
}

function SliderField({ k, label, term, help, min, max, step, format, disabled }: SliderFieldProps) {
  const value = useScenario((s) => s.definitions[k]);
  const out = useRef<HTMLSpanElement>(null);
  return (
    <Field
      label={label}
      term={term}
      help={help}
      value={
        <span ref={out} className="def-field__value num" data-field={k}>
          {format(value)}
        </span>
      }
    >
      <Slider
        ariaLabel={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        data-field={k}
        onLive={(v) => out.current && (out.current.textContent = format(v))}
        onCommit={(v) => getScenario().setDefinitions({ [k]: v } as Partial<Definitions>)}
      />
    </Field>
  );
}

export function DefinitionsEditor({ onClose }: { onClose: () => void }) {
  const t = useCopyFn();
  const height = useScenario((s) => s.heightM);
  const dsnMode = useScenario((s) => s.definitions.dsnMode);
  const preset = useScenario((s) => s.definitionsPreset);
  const pct = (v: number) => `${Math.round(v)}%`;
  const deg = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}°`;
  const isro = preset === 'isroVikramOps';

  return (
    <div className="def-editor">
      <div className="def-editor__head">
        <h2 className="def-editor__title">{t('def.title')}</h2>
        <button type="button" className="def-editor__close" aria-label={t('def.close')} onClick={onClose}>
          ×
        </button>
      </div>
      <p className="def-editor__intro">{t('def.intro')}</p>

      <div className="def-editor__preset">
        <button
          type="button"
          className="def-preset-btn"
          aria-pressed={isro}
          data-preset="isroVikramOps"
          onClick={() => getScenario().applyDefinitionsPreset('isroVikramOps')}
        >
          <span className="def-preset-btn__glyph" aria-hidden="true">
            {isro ? '●' : '○'}
          </span>
          <span className="def-preset-btn__text">{t('def.preset.isroVikramOps')}</span>
          {isro && <span className="def-preset-btn__state">{t('def.preset.active')}</span>}
        </button>
        <p className="def-field__help">{t('def.preset.isroVikramOps.source')}</p>
      </div>

      <div className="def-editor__grid">
        <SliderField
          k="sunDiskThresholdPct"
          label={t('def.f.sunDisk')}
          term="sun_available"
          help={t('def.f.sunDisk.help')}
          min={10}
          max={100}
          step={5}
          format={pct}
        />
        <Field label={t('def.f.height')} term="mast_height" help={t('def.f.height.help')}>
          <Segmented<MastHeightM>
            size="sm"
            ariaLabel={t('def.f.height')}
            value={height}
            onChange={(h) => getScenario().setHeight(h)}
            options={HEIGHTS.map((h) => ({ value: h, label: <span className="num">{h} m</span> }))}
          />
        </Field>
        <SliderField
          k="minSunElevationOps"
          label={t('def.f.minSunElev')}
          term="min_sun_elevation_ops"
          help={t('def.f.minSunElev.help')}
          min={0}
          max={10}
          step={0.5}
          format={(v) => (v > 0 ? deg(v) : t('def.off'))}
        />
        <SliderField
          k="earthMarginDeg"
          label={t('def.f.earthMargin')}
          term="dte_margin"
          help={t('def.f.earthMargin.help')}
          min={0}
          max={5}
          step={0.5}
          format={deg}
        />
        <SliderField
          k="dteDiskThresholdPct"
          label={t('def.f.dteDisk')}
          term="earth_link"
          help={t('def.f.dteDisk.help')}
          min={10}
          max={100}
          step={5}
          format={pct}
        />
        <Field label={t('def.f.dsnMode')} term="dsn_visibility" help={t('def.f.dsnMode.help')}>
          <Segmented<DsnMode>
            size="sm"
            ariaLabel={t('def.f.dsnMode')}
            value={dsnMode}
            onChange={(m) => getScenario().setDefinitions({ dsnMode: m })}
            options={[
              { value: 'off', label: t('def.dsn.off') },
              { value: 'dsnAware', label: t('def.dsn.dsnAware') },
            ]}
          />
        </Field>
        <SliderField
          k="dsnMaskDeg"
          label={t('def.f.dsnMask')}
          term="dsn_visibility"
          help={t('def.f.dsnMask.help')}
          min={0}
          max={20}
          step={1}
          format={deg}
          disabled={dsnMode === 'off'}
        />
      </div>

      <div className="def-editor__foot">
        <button
          type="button"
          className="def-link-btn"
          disabled={preset === 'default'}
          onClick={() => getScenario().applyDefinitionsPreset('default')}
        >
          {t('def.preset.default')}
        </button>
      </div>
    </div>
  );
}
