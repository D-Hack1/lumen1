// Owner: Abhinav
// Cockpit right column · "Profile & Battery" (slot `profileBattery`, header 48 / 40 / 36 px).
// Header (one line): battery verdict for the Cockpit scenario — "survives longest night ✓ with X h margin" — plus the
// verdict-relevant summary. Opens as an emil accordion OVERLAY (kit Accordion: rises over the Touchdown Pad, never
// pushes the layout, no scroll): the same Mission Profile fields in compact form + the battery detail.
import { useState } from 'react';
import { useResult } from '../../engine/hooks';
import { useCopyFn } from '../../state/copy';
import { useScenario } from '../../state/scenarioStore';
import { Accordion } from '../../ui/Accordion';
import { batteryHeadline } from './rowModel';
import { GlyphText } from './BatteryLine';
import { MissionProfileForm } from './MissionProfileForm';
import { batteryCheck } from './profileModel';
import './scenarios.css';

export function ProfileBatteryAccordion() {
  const t = useCopyFn();
  const [open, setOpen] = useState(false);
  const profile = useScenario((s) => s.profile);
  const night = useResult().metrics?.longestNightH ?? null;
  const b = batteryCheck(profile, night);
  const { glyph, text } = batteryHeadline(b, t);

  return (
    <Accordion
      open={open}
      onOpenChange={setOpen}
      label={t('battery.title')}
      className="pb-acc"
      panelClassName="pb-acc__panel"
      header={
        <>
          <span className="pb-acc__title">{t('battery.title')}</span>
          <span className="pb-acc__verdict truncate" data-status={b.status} data-testid="battery-header">
            <GlyphText text={text} glyph={glyph} />
          </span>
        </>
      }
    >
      <MissionProfileForm variant="compact" longestNightH={night} nightSource={t('battery.source.cockpit')} />
    </Accordion>
  );
}
