import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ToastType } from '../constants/toast';
import { ToastContext } from '../hooks/useToast';

// Re-export for backwards compatibility
// eslint-disable-next-line react-refresh/only-export-components
export { setGlobalToast, toast } from '../constants/toast';
export type { ToastType } from '../constants/toast';
// eslint-disable-next-line react-refresh/only-export-components
export { useToast } from '../hooks/useToast';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

// Individual Toast component
function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(onClose, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.duration, onClose]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-400" />,
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
    info: <Info className="w-5 h-5 text-blue-400" />,
  };

  const backgrounds = {
    success: 'bg-green-900/90 border-green-500',
    error: 'bg-red-900/90 border-red-500',
    warning: 'bg-yellow-900/90 border-yellow-500',
    info: 'bg-blue-900/90 border-blue-500',
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${backgrounds[toast.type]} backdrop-blur-sm shadow-lg animate-slide-in-right`}
      role="alert"
    >
      {icons[toast.type]}
      <p className="text-white text-sm sequel-45 flex-1">{toast.message}</p>
      <button
        onClick={onClose}
        className="text-white/70 hover:text-white transition-colors p-1"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// Toast Provider component
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration: number = 5000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {/* Toast container - fixed position at top right */}
      <div className="fixed top-20 right-4 z-100 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} onClose={() => hideToast(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// CSS animation (add to your global styles or Tailwind config)
// @keyframes slide-in-right {
//   from { transform: translateX(100%); opacity: 0; }
//   to { transform: translateX(0); opacity: 1; }
// }
// .animate-slide-in-right { animation: slide-in-right 0.3s ease-out; }
