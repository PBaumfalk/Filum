import { AlertTriangle, Check } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
  action?: { label: string; run: () => void };
}

interface ToastApi {
  ok: (text: string, action?: Toast['action']) => void;
  error: (text: string | unknown) => void;
}

const Ctx = createContext<ToastApi>({ ok: () => {}, error: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    window.setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.action ? 6500 : t.kind === 'error' ? 6000 : 3200);
  }, []);

  const api: ToastApi = {
    ok: useCallback((text, action) => push({ text, kind: 'ok', action }), [push]),
    error: useCallback(
      (e) => push({ text: typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unbekannter Fehler', kind: 'error' }),
      [push],
    ),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            {t.kind === 'error' ? <AlertTriangle aria-hidden /> : <Check aria-hidden />}
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn"
                onClick={() => {
                  t.action!.run();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
