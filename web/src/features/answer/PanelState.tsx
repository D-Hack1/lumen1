// Owner: Nived
// What a panel shows when it has no result to draw: loading, or an error with the engine's own message.
// (UI critique B4: panels must never be silently blank.)
import { useCopyFn } from '../../state/copy';
import './answer.css';

export function PanelState({ status, message }: { status: 'loading' | 'error'; message: string | null }) {
  const t = useCopyFn();
  if (status === 'loading') {
    return (
      <div className="panel-state" aria-busy="true">
        <span className="panel-state__title">{t('state.loading')}</span>
      </div>
    );
  }
  return (
    <div className="panel-state panel-state--error" role="alert">
      <span className="panel-state__title">{t('state.error')}</span>
      <span className="panel-state__msg">{message && message.trim() ? message : t('state.errorUnknown')}</span>
    </div>
  );
}
