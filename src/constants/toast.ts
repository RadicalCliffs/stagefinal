/**
 * Toast Constants and Utilities
 *
 * These functions are used for showing toast notifications outside of React components.
 * Separated from components to avoid React Fast Refresh issues.
 */

// Toast types
export type ToastType = 'success' | 'error' | 'warning' | 'info';

// Utility function for use outside React components (e.g., in services)
// This creates a simple alert fallback when ToastProvider is not available
let globalToastFn: ((message: string, type?: ToastType, duration?: number) => void) | null = null;

export function setGlobalToast(fn: typeof globalToastFn) {
  globalToastFn = fn;
}

export function toast(message: string, type: ToastType = 'info', duration: number = 5000) {
  if (globalToastFn) {
    globalToastFn(message, type, duration);
  } else {
    // Fallback to console for development or when provider is not mounted
    console.warn('[Toast]', type.toUpperCase(), message);
  }
}
