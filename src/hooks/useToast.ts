/**
 * Toast Hook
 *
 * This hook is separated from Toast.tsx to avoid React Fast Refresh issues.
 * Use this hook to display toast notifications in your components.
 */

import { useContext, createContext } from 'react';
import type { ToastType } from '../constants/toast';

export interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  hideToast: (id: string) => void;
}

// Create context here but it will be provided by ToastProvider
export const ToastContext = createContext<ToastContextType | null>(null);

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
