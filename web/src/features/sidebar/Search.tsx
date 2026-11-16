// Owner: Abhinav
// Site search (PLAN §8.4): filters cards by name / agency / category words. When the text is a coordinate pair
// ("−84.79, 29.20", "84.79S 29.2E") it offers two actions in a small menu under the field:
//   "Analyse custom point" → store.setCustomPoint (Enter does the same) · "Quick Answer" → QuickAnswerPeek.
// The menu is portalled + fixed so it never changes the 92/84 px search slot (zero page scroll).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fill } from '../../engine/format';
import { useCopyFn } from '../../state/copy';
import { getScenario } from '../../state/scenarioStore';
import { QuickAnswerPeek } from './QuickAnswerPeek';
import { fmtLat, fmtLon, parseLatLon, type LatLon } from './siteModel';

export interface SearchProps {
  value: string;
  onChange(v: string): void;
}

/** Focus the Site Explorer search (Mission Bar site label, PLAN §8.2). */
export function focusSiteSearch(): void {
  document.querySelector<HTMLInputElement>('[data-site-search]')?.focus();
}

export function Search({ value, onChange }: SearchProps) {
  const t = useCopyFn();
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [quick, setQuick] = useState<LatLon | null>(null);
  const point = parseLatLon(value);
  const showMenu = !!point && focused && !quick;

  useLayoutEffect(() => {
    if (!showMenu || !input.current || !menu.current) return;
    const place = () => {
      const r = input.current!.getBoundingClientRect();
      const m = menu.current!;
      m.style.left = `${Math.round(r.left)}px`;
      m.style.top = `${Math.round(r.bottom + 4)}px`;
      m.style.width = `${Math.round(Math.max(r.width, 220))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [showMenu]);

  // Close the menu when focus leaves both the field and the menu.
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: PointerEvent) => {
      const tgt = e.target as Node;
      if (!input.current?.contains(tgt) && !menu.current?.contains(tgt)) setFocused(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [focused]);

  const analyse = (p: LatLon) => {
    getScenario().setCustomPoint(Math.round(p.lat * 1e4) / 1e4, Math.round(p.lon * 1e4) / 1e4);
    setFocused(false);
    input.current?.blur();
  };

  return (
    <div className="sb-search">
      <span className="sb-search__icon" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={input}
        data-site-search
        type="search"
        className="sb-search__input"
        placeholder={t('sb.search')}
        aria-label={t('sb.search.long')}
        title={t('sb.search.long')}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setFocused(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && point) analyse(point);
          else if (e.key === 'ArrowDown' && showMenu) {
            e.preventDefault();
            menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
          } else if (e.key === 'Escape') {
            if (value) onChange('');
            else input.current?.blur();
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="sb-search__clear"
          aria-label={t('sb.search.clear')}
          onClick={() => onChange('')}
        >
          ×
        </button>
      )}
      {showMenu &&
        createPortal(
          <div
            ref={menu}
            className="sb-coord-menu"
            role="menu"
            aria-label={fill(t('sb.coord.hint'), { lat: fmtLat(point.lat), lon: fmtLon(point.lon) })}
            onKeyDown={(e) => {
              const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
              const i = items.indexOf(document.activeElement as HTMLButtonElement);
              if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
              else if (e.key === 'ArrowUp') (i <= 0 ? input.current : items[i - 1])?.focus();
              else if (e.key === 'Escape') input.current?.focus();
              else return;
              e.preventDefault();
            }}
          >
            <div className="sb-coord-menu__hint num">
              {fill(t('sb.coord.hint'), { lat: fmtLat(point.lat), lon: fmtLon(point.lon) })}
            </div>
            <button
              type="button"
              role="menuitem"
              className="sb-coord-menu__item"
              data-action="analyse"
              onClick={() => analyse(point)}
            >
              <span aria-hidden="true">+</span> {t('sb.coord.analyse')}
              <kbd>Enter</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className="sb-coord-menu__item"
              data-action="quick"
              onClick={() => {
                setQuick(point);
                setFocused(false);
              }}
            >
              <span aria-hidden="true">≈</span> {t('sb.coord.quick')}
            </button>
          </div>,
          document.body,
        )}
      <QuickAnswerPeek point={quick} anchor={input} onClose={() => setQuick(null)} onOpen={analyse} />
    </div>
  );
}
