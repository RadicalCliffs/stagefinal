/**
 * Payment Error Boundary HOC
 *
 * This HOC is separated from PaymentErrorBoundary.tsx to avoid React Fast Refresh issues.
 */

import React from 'react';
import PaymentErrorBoundary from '../components/PaymentErrorBoundary';

/**
 * Hook-style error boundary wrapper for functional components
 */
export function withPaymentErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: {
    onReset?: () => void;
    onBack?: () => void;
  }
) {
  return function PaymentErrorBoundaryWrapper(props: P) {
    return (
      <PaymentErrorBoundary onReset={options?.onReset} onBack={options?.onBack}>
        <WrappedComponent {...props} />
      </PaymentErrorBoundary>
    );
  };
}
