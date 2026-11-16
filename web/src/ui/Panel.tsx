// Owner: Abhinav
// Panel — the base surface for every bento slot. Elevation = surface colour + 1 px hairline (no shadow, no blur).
import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  /** Body scrolls internally (only whitelisted containers: site list, Windows Table body, Scan list, Methodology). */
  scroll?: boolean;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Panel({ title, actions, scroll, className, bodyClassName, children, ...rest }: PanelProps) {
  return (
    <section className={['ui-panel', className].filter(Boolean).join(' ')} {...rest}>
      {(title || actions) && (
        <header className="ui-panel__head">
          <h2 className="ui-panel__title truncate">{title}</h2>
          {actions && <div className="ui-panel__actions">{actions}</div>}
        </header>
      )}
      <div
        className={['ui-panel__body', bodyClassName].filter(Boolean).join(' ')}
        data-scroll={scroll ? 'allowed' : undefined}
      >
        {children}
      </div>
    </section>
  );
}
