// Owner: Abhinav
// Badge — compact status label. Every tone carries a glyph or text; colour is never the only signal (§5.3).
import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'tier'
  | 'go'
  | 'marginal'
  | 'nogo'
  | 'pending'
  | 'sun'
  | 'earth'
  | 'both'
  | 'blocked'
  | 'provisional'
  | 'mock';

const GLYPH: Partial<Record<BadgeTone, string>> = {
  go: '●',
  marginal: '◐',
  nogo: '✕',
  pending: '○',
  sun: '☀',
  earth: '◉',
  both: '◆',
  blocked: '▨',
  provisional: '~',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Override or hide (null) the default glyph. */
  glyph?: string | null;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function Badge({ tone = 'neutral', glyph, size = 'sm', className, children, ...rest }: BadgeProps) {
  const g = glyph === undefined ? GLYPH[tone] : glyph;
  return (
    <span
      className={['ui-badge', `ui-badge--${tone}`, `ui-badge--${size}`, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {g && (
        <span className="ui-badge__glyph" aria-hidden="true">
          {g}
        </span>
      )}
      <span className="ui-badge__text">{children}</span>
    </span>
  );
}
