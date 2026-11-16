// Owner: Abhinav
// Mission Bar verdict chip: GO / MARGINAL / NO-GO / PENDING, with a "provisional" modifier. Opens the Mission
// Profile popover (placeholder until Phase 4).
// Motion (§1.4, emil rules): on change the old chip and the new chip crossfade over 120 ms (opacity only, same
// cell, no size animation). Each layer animates from its *current* opacity, so rapid changes never pop.
// Reduced motion → 80 ms. The chip is not on the Fast Lane: it changes at worker-result rate, not pointer rate.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MissionProfileSummary } from '../features/scenarios/MissionProfileSummary';
import { useCopyFn } from '../state/copy';
import { useScenario } from '../state/scenarioStore';
import { Badge } from '../ui/Badge';
import { Popover } from '../ui/Popover';
import { motion } from '../ui/tokens';
import { VERDICT_TONE, type ChipState } from './verdict';

/** useLayoutEffect in the browser, useEffect under SSR (unit tests) — avoids the server warning. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

interface Layer extends ChipState {
  id: number;
  leaving: boolean;
  animateIn: boolean;
}

function ChipLayer({ layer, onGone }: { layer: Layer; onGone: (id: number) => void }) {
  const t = useCopyFn();
  const ref = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation | null>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      if (layer.leaving) onGone(layer.id);
      return;
    }
    if (!layer.leaving && !layer.animateIn) return; // first paint: no fade
    const from = anim.current ? Number.parseFloat(getComputedStyle(el).opacity) : layer.leaving ? 1 : 0;
    anim.current?.cancel();
    const a = el.animate([{ opacity: from }, { opacity: layer.leaving ? 0 : 1 }], {
      duration: reduced() ? motion.durReduced : motion.durFast,
      easing: motion.easeOut,
      fill: 'forwards',
    });
    anim.current = a;
    a.onfinish = () => {
      if (anim.current !== a) return;
      anim.current = null;
      if (layer.leaving) onGone(layer.id);
      else a.cancel(); // settle on the base style
    };
  }, [layer.leaving, layer.animateIn, layer.id, onGone]);

  return (
    <span
      ref={ref}
      className="mb-verdict__layer"
      aria-hidden={layer.leaving || undefined}
      data-leaving={layer.leaving || undefined}
    >
      <Badge
        tone={layer.provisional ? 'provisional' : VERDICT_TONE[layer.verdict]}
        size="md"
        className="mb-verdict__chip"
        data-verdict={layer.verdict}
        data-provisional={layer.provisional || undefined}
      >
        {t(`verdict.${layer.verdict}`)}
        {layer.provisional && <span className="mb-verdict__prov mb-mid"> · {t('verdict.provisional')}</span>}
      </Badge>
    </span>
  );
}

export function VerdictChip({ state, reasons }: { state: ChipState; reasons: string[] }) {
  const t = useCopyFn();
  const setView = useScenario((s) => s.setView);
  const btn = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const [layers, setLayers] = useState<Layer[]>(() => [{ ...state, id: 0, leaving: false, animateIn: false }]);

  const sig = `${state.verdict}|${state.provisional}`;
  useEffect(() => {
    setLayers((ls) => {
      const cur = ls.find((l) => !l.leaving);
      if (cur && cur.verdict === state.verdict && cur.provisional === state.provisional) return ls;
      const id = ++seq.current;
      // keep at most one older layer still fading out, plus the one that starts leaving now
      const leaving = ls.filter((l) => l.leaving).slice(-1);
      const out = cur ? [{ ...cur, leaving: true }] : [];
      return [...leaving, ...out, { ...state, id, leaving: false, animateIn: true }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const onGone = useRef((id: number) => setLayers((ls) => ls.filter((l) => l.id !== id))).current;
  const title = `${t(state.provisional ? 'verdict.provisional.long' : `verdict.${state.verdict}.long`)}`;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="mb-verdict"
        title={title}
        aria-label={`${t('mb.verdict')}: ${t(`verdict.${state.verdict}`)}${state.provisional ? ` (${t('verdict.provisional')})` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-verdict={state.verdict}
        data-provisional={state.provisional || undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mb-verdict__stack">
          {layers.map((l) => (
            <ChipLayer key={l.id} layer={l} onGone={onGone} />
          ))}
        </span>
      </button>
      <Popover
        id={popId}
        open={open}
        onClose={() => setOpen(false)}
        anchor={btn}
        label={t('profile.title')}
        align="end"
      >
        <MissionProfileSummary
          verdict={state.verdict}
          provisional={state.provisional}
          reasons={reasons}
          onEdit={() => {
            setOpen(false);
            setView('compare');
          }}
        />
      </Popover>
    </>
  );
}
