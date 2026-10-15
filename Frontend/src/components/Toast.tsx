/* ===========================================================================
 * Toast — simple, transient notification surface
 * ==========================================================================*/
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface Toast { id: number; kind: 'info' | 'success' | 'error' | 'warn'; message: string; }
const ToastCtx = createContext<(message: string, kind?: Toast['kind']) => void>(() => {});

export function useToast() { return useContext(ToastCtx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-area">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Use in async/await chains: try { ... } catch (e) { notifyError(e); } */
export function notifyError(err: unknown, push: (m: string, k?: Toast['kind']) => void) {
  if (err instanceof Error) push(err.message, 'error');
  else push('An unknown error occurred.', 'error');
}

// Re-export so App can wrap
export default ToastProvider;
