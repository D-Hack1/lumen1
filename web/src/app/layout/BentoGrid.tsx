// Owner: Abhinav
// Bento grid primitives. Track sizes are CSS vars generated from tokens.ts (slotBudget/sideBudget/colBudget) and
// switched by the density attributes on <html>; see layout.css. Every track is min-height: 0.
import type { ReactNode } from 'react';

export function BentoGrid({ view, children }: { view: 'cockpit' | 'compare'; children: ReactNode }) {
  return (
    <div className={`bento bento--${view}`} data-bento={view}>
      {children}
    </div>
  );
}

export function BentoColumn({
  side,
  className,
  children,
}: {
  side: 'left' | 'centre' | 'right';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={['bento__col', `bento__col--${side}`, className].filter(Boolean).join(' ')} data-col={side}>
      {children}
    </div>
  );
}
