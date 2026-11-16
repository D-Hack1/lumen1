// Owner: Ebin (live pages; replaces the 2-line stub)
// Quick-Start: four guided scenarios (PLAN_FINAL §8.9). Each card applies a real state of the app (site, array height, slip, page)
// and says what to look at, with a credited local image. Opens from the header's "Quick start" button, on a real first visit
// (see shouldAutoOpen), and with ?quickstart=1. Esc closes; focus is kept inside while open and returned afterwards.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LumenContext } from '../orbit/lumenState';
import { go } from '../pages/nav';
import { OPEN_QUICKSTART_EVENT, loadQuickStart, markQuickStartSeen, resolveCard, shouldAutoOpen, type QuickStartCard } from './quickstart';
import './quickstart.css';

const base = (): string => {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.replace(/\/$/, '');
};

export function QuickStartDrawer() {
  const lumen = useContext(LumenContext);
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<QuickStartCard[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    markQuickStartSeen();
    setOpen(false);
    returnFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    void loadQuickStart().then(setCards);
    if (shouldAutoOpen()) setOpen(true);
    const onOpen = () => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    window.addEventListener(OPEN_QUICKSTART_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUICKSTART_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab' && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>('button, a[href]')].filter((el) => !el.hasAttribute('disabled'));
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  if (!open || !lumen) return null;

  const start = (card: QuickStartCard) => {
    const r = resolveCard(card, lumen.allSites.map((s) => s.id));
    if (r.siteId) lumen.selectSite(r.siteId);
    if (r.mastM != null) lumen.setMast(r.mastM);
    if (r.slipDays != null) lumen.setSlip(r.slipDays);
    for (const id of r.pickIds) lumen.addPick(id);
    markQuickStartSeen();
    setOpen(false);
    go(r.route);
  };

  return (
    <div className={`lm-qs ${lumen.light ? 'lm-theme-light' : 'lm-theme-dark'}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={panel} className="lm-qs__panel" role="dialog" aria-modal="true" aria-labelledby="lm-qs-title">
        <div className="lm-qs__head">
          <div>
            <h2 id="lm-qs-title" className="lm-qs__title">
              Quick start
            </h2>
            <p className="lm-qs__lede">Four ways in. Each one sets the app up and tells you what to look at.</p>
          </div>
          <button type="button" className="lm-qs__close" onClick={close} aria-label="Close quick start">
            ✕
          </button>
        </div>
        <div className="lm-qs__grid">
          {cards.map((c) => (
            <article key={c.id} className="lm-qs__card" data-card={c.id}>
              <div className="lm-qs__img">
                <img src={`${base()}/${c.image}`} alt={c.alt} loading="lazy" />
              </div>
              <div className="lm-qs__body">
                <h3 className="lm-qs__ctitle">{c.title}</h3>
                <p className="lm-qs__blurb">{c.blurb}</p>
                <ul className="lm-qs__steps">
                  {c.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <div className="lm-qs__foot">
                  <button type="button" className="lm-qs__go" onClick={() => start(c)}>
                    Start
                  </button>
                  <span className="lm-qs__credit">
                    {c.sourceUrl ? (
                      <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                        {c.credit}
                      </a>
                    ) : (
                      c.credit
                    )}
                  </span>
                </div>
              </div>
            </article>
          ))}
          {cards.length === 0 && <p className="lm-qs__lede">Loading…</p>}
        </div>
      </div>
    </div>
  );
}
