// Owner: Abhinav
// Definitions Bar (PLAN §8.3; R3 D-10): one line stating the active rules, a preset chip ("Preset: ISRO ops") with a
// reset, and ✎ opening the editor popover. Fills the `definitions` slot (28 / 26 / 24 px). The two rule halves
// truncate independently so both stay readable at V4; the full text is in the title and in the popover.
// Popover motion (emil): origin-aware scale 0.96 → 1, 150 ms enter / 120 ms exit, interruptible (ui/Popover).
import { useRef, useState } from 'react';
import { useCopyFn } from '../../state/copy';
import { getScenario, useScenario } from '../../state/scenarioStore';
import { InfoBadge } from '../../ui/InfoBadge';
import { Popover } from '../../ui/Popover';
import { DefinitionsEditor } from './DefinitionsEditor';
import { linkRuleText, sunRuleText } from './definitionsText';
import './definitions.css';

export function DefinitionsBar() {
  const t = useCopyFn();
  const defs = useScenario((s) => s.definitions);
  const height = useScenario((s) => s.heightM);
  const preset = useScenario((s) => s.definitionsPreset);
  const [open, setOpen] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const rules = useRef<HTMLButtonElement>(null);
  const inside = useRef([rules]).current;

  const sun = sunRuleText(defs, height, t);
  const link = linkRuleText(defs, t);
  const full = `${sun} · ${link}`;

  return (
    <div className="def-bar" data-preset={preset}>
      <span className="def-bar__label">
        {t('def.label')} <InfoBadge term="sun_available" label={t('def.label')} />
      </span>
      <button
        ref={rules}
        type="button"
        className="def-bar__rules"
        title={full}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="definitions-line"
      >
        <span className="def-bar__rule truncate" data-rule="sun">
          {sun}
        </span>
        <span className="def-bar__sep" aria-hidden="true">
          ·
        </span>
        <span className="def-bar__rule truncate" data-rule="link">
          {link}
        </span>
      </button>
      {preset !== 'default' && (
        <span className="def-bar__preset" data-chip={preset}>
          <span className="truncate">{t(`def.chip.${preset}`)}</span>
          <button
            type="button"
            className="def-bar__reset"
            aria-label={t('def.chip.reset')}
            title={t('def.chip.reset')}
            onClick={() => getScenario().applyDefinitionsPreset('default')}
          >
            ×
          </button>
        </span>
      )}
      <button
        ref={pencil}
        type="button"
        className="def-bar__edit"
        aria-label={t('def.edit')}
        title={t('def.edit')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ✎
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={pencil}
        label={t('def.title')}
        className="def-popover"
        insideRefs={inside}
      >
        <DefinitionsEditor onClose={() => setOpen(false)} />
      </Popover>
    </div>
  );
}
