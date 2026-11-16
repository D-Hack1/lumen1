// Owner: Abhinav
// CreditLine — the credit on the foot of a body image or map layer (guide §3.3, PLAN §8.1). Static text, no motion,
// safe next to live canvases (no blur, no shadow). Usage:
//   <CreditLine id="sun_sdo" overlay />                       → entry from content/credits.ts (Ebin's Lens)
//   <CreditLine entry={layerCredit(layer.source, layer.derived)} overlay />   (Nived's Basemap layer)
//   <CreditLine ids={['sun_sdo', 'earth_epic']} />             → several assets on one line
// `overlay` positions it absolutely at the bottom-left of the nearest positioned parent (pointer-transparent except
// the source link). Unknown ids render nothing (and warn in dev) so a missing entry never shows a raw key.
import type { HTMLAttributes } from 'react';
import { getCredit, type CreditEntry } from '../content/credits';
import { useCopyFn } from '../state/copy';

export interface CreditLineProps extends HTMLAttributes<HTMLElement> {
  id?: string;
  ids?: string[];
  entry?: CreditEntry;
  /** Absolutely positioned on the image foot. */
  overlay?: boolean;
  /** Corner when `overlay` (default bottom-left). */
  corner?: 'bl' | 'br';
}

export function CreditLine({ id, ids, entry, overlay, corner = 'bl', className, ...rest }: CreditLineProps) {
  const t = useCopyFn();
  const list: CreditEntry[] = [];
  if (entry) list.push(entry);
  for (const k of [...(id ? [id] : []), ...(ids ?? [])]) {
    const e = getCredit(k);
    if (e) list.push(e);
    else if (import.meta.env?.DEV) console.warn(`CreditLine: no credit entry "${k}" in content/credits.ts`);
  }
  if (!list.length) return null;

  const title = list.map((e) => `${e.what} — ${e.credit} · ${e.license}`).join('\n');
  return (
    <small
      className={['ui-credit', overlay && 'ui-credit--overlay', overlay && `ui-credit--${corner}`, className]
        .filter(Boolean)
        .join(' ')}
      title={title}
      data-credit={list.map((e) => e.credit).join(' | ')}
      {...rest}
    >
      <span className="ui-credit__label">{t('credit.prefix')}</span>{' '}
      {list.map((e, i) => (
        <span key={e.credit} className="ui-credit__item">
          {i > 0 && ' · '}
          {e.sourceUrl ? (
            <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener">
              {e.credit}
            </a>
          ) : (
            e.credit
          )}
        </span>
      ))}
    </small>
  );
}
