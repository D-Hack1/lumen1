// Owner: Abhinav
// Card — raised surface (site cards, Quick-Start cards). Interactive cards get press feedback (transform only).
import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  selected?: boolean;
  children?: ReactNode;
}

export function Card({ interactive, selected, className, children, ...rest }: CardProps) {
  return (
    <div
      className={['ui-card', interactive && 'ui-card--interactive', selected && 'is-selected', className]
        .filter(Boolean)
        .join(' ')}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-pressed={interactive ? !!selected : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
