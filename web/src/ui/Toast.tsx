// Owner: Abhinav
// Toast — Share URL / export confirmations. Vanilla queue (no React provider needed to call `toast()`).
// Motion (emil): slide + fade enter 180 ms, exit 120 ms (exit ≤ enter), swipe-right to dismiss (transform only).
// Reduced motion collapses to opacity (global.css vars).
import { useRef, useSyncExternalStore } from 'react';

export interface ToastItem {
  id: number;
  message: string;
  tone: 'neutral' | 'success' | 'error';
  leaving: boolean;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const EXIT_MS = 120;

export function dismissToast(id: number) {
  const t = items.find((x) => x.id === id);
  if (!t || t.leaving) return;
  items = items.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  emit();
  window.setTimeout(() => {
    items = items.filter((x) => x.id !== id);
    emit();
  }, EXIT_MS);
}

export function toast(message: string, opts: { tone?: ToastItem['tone']; durationMs?: number } = {}): number {
  const id = nextId++;
  items = [...items.slice(-2), { id, message, tone: opts.tone ?? 'neutral', leaving: false }];
  emit();
  window.setTimeout(() => dismissToast(id), opts.durationMs ?? 4000);
  return id;
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
const snapshot = () => items;

function ToastCard({ t }: { t: ToastItem }) {
  const el = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const dx = useRef(0);
  return (
    <div
      ref={el}
      role="status"
      className={['ui-toast', `ui-toast--${t.tone}`, t.leaving && 'is-leaving'].filter(Boolean).join(' ')}
      onPointerDown={(e) => {
        start.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.style.transition = 'none';
      }}
      onPointerMove={(e) => {
        if (start.current == null) return;
        dx.current = Math.max(0, e.clientX - start.current);
        e.currentTarget.style.transform = `translateX(${dx.current}px)`;
        e.currentTarget.style.opacity = String(1 - Math.min(dx.current / 160, 0.8));
      }}
      onPointerUp={(e) => {
        const s = e.currentTarget.style;
        s.transition = '';
        start.current = null;
        if (dx.current > 60) dismissToast(t.id);
        else {
          s.transform = '';
          s.opacity = '';
        }
        dx.current = 0;
      }}
    >
      <span>{t.message}</span>
      <button type="button" className="ui-toast__close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
        ×
      </button>
    </div>
  );
}

/** Mount once at the app root. Fixed overlay: never affects layout or page scroll. */
export function ToastViewport() {
  const list = useSyncExternalStore(subscribe, snapshot);
  return (
    <div className="ui-toast-viewport" aria-live="polite">
      {list.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  );
}
