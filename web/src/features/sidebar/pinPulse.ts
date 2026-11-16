// Owner: Abhinav
// Card hover → Basemap pin pulse (guide §1.4: "Card hover → pin pulse is CSS opacity only").
//
// The card writes `siteHoverBus.set({ siteId })` on pointer enter/leave (no React state). This binding subscribes
// (≤ once per frame, inside the frame bus) and toggles `.is-card-hover` on the matching element inside `.basemap`;
// the pulse itself is a CSS opacity keyframe in sidebar.css.
//
// INTERIM WORKAROUND (WORK_DISTRIBUTION §7.3): Nived's pins carry no site id attribute yet, so in-map pins are
// matched by their <title> (= site name). Off-map indicators already have `data-offmap="<id>"`. Change request to
// Nived: add `data-site={s.id}` to each `.basemap__pin` (or subscribe to `siteHoverBus` in Basemap) — then the
// title match below is deleted and only the attribute selector stays.
import { siteHoverBus } from '../../state/buses';

let names = new Map<string, string>(); // site id → name (for the title fallback)
let lit: Element[] = [];

export function setPulseNames(map: Map<string, string>): void {
  names = map;
}

function targets(siteId: string): Element[] {
  const root = document.querySelector('.basemap');
  if (!root) return [];
  const esc = CSS.escape(siteId);
  const direct = Array.from(root.querySelectorAll(`[data-site="${esc}"], [data-offmap="${esc}"]`));
  if (direct.some((el) => el.matches('[data-site]'))) return direct;
  const name = names.get(siteId);
  if (!name) return direct;
  const byTitle = Array.from(root.querySelectorAll('.basemap__pin')).filter(
    (pin) => pin.querySelector('title')?.textContent === name,
  );
  return [...direct, ...byTitle];
}

function apply(siteId: string | null): void {
  for (const el of lit) el.classList.remove('is-card-hover');
  lit = siteId ? targets(siteId) : [];
  for (const el of lit) el.classList.add('is-card-hover');
}

let refs = 0;
let off: (() => void) | null = null;

/** Mount once per Sidebar; returns the unmount function. */
export function startPinPulse(): () => void {
  if (refs++ === 0) off = siteHoverBus.subscribe((v) => apply(v.siteId));
  return () => {
    if (--refs === 0) {
      off?.();
      off = null;
      apply(null);
    }
  };
}
