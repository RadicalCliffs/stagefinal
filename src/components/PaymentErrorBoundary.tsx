import { Component, type ReactNode } from 'react';
import { AlertCircle, RefreshCw, ArrowLeft, MessageCircle } from 'lucide-react';

interface PaymentErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
  onBack?: () => void;
}

interface PaymentErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Specialized error boundary for payment flows
 * Provides user-friendly recovery options specific to payment scenarios
 */
class PaymentErrorBoundary extends Component<PaymentErrorBoundaryProps, PaymentErrorBoundaryState> {
  constructor(props: PaymentErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<PaymentErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[PaymentErrorBoundary] Payment error caught:', error, errorInfo);
    this.setState({ errorInfo });

    // Log to analytics/monitoring service in production
    // This is where you'd send to Sentry, LogRocket, etc.
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
      // Example: window.Sentry?.captureException(error);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  handleBack = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onBack?.();
  };

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'An unexpected error occurred';
      const isNetworkError = errorMessage.toLowerCase().includes('network') ||
        errorMessage.toLowerCase().includes('fetch');
      const isTimeoutError = errorMessage.toLowerCase().includes('timeout');

      return (
        <div className="bg-[#1A1A1A] border border-red-500/30 rounded-xl p-6 text-center max-w-md mx-auto">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>

          <h3 className="text-white sequel-95 text-xl mb-2">Payment Error</h3>

          <p className="text-white/70 sequel-45 text-sm mb-4">
            {isNetworkError
              ? 'Connection lost. Please check your internet and try again.'
              : isTimeoutError
              ? 'The request timed out. Please try again.'
              : 'Something went wrong with your payment. Your funds are safe.'}
          </p>

          {/* Error details (collapsed by default) */}
          <details className="text-left mb-6 bg-[#262626] rounded-lg p-3">
            <summary className="text-white/50 text-xs cursor-pointer sequel-45">
              Technical details
            </summary>
            <p className="text-red-400/70 text-xs mt-2 font-mono break-all">
              {errorMessage}
            </p>
          </details>

          <div className="space-y-3">
            <button
              onClick={this.handleRetry}
              className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-[#DDE404] text-black sequel-75 uppercase rounded-lg hover:bg-[#DDE404]/90 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>

            {this.props.onBack && (
              <button
                onClick={this.handleBack}
                className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-transparent border border-white/30 text-white sequel-45 rounded-lg hover:bg-white/10 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Go Back
              </button>
            )}

            <a
              href="https://t.me/theprizeannouncements"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2 text-white/50 hover:text-white/70 sequel-45 text-sm transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              Contact Support
            </a>
          </div>

          <p className="text-white/40 text-xs sequel-45 mt-4">
            If your payment was charged, please contact support with your transaction details.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PaymentErrorBoundary;

// Re-export HOC from separate file for backwards compatibility
// eslint-disable-next-line react-refresh/only-export-components
export { withPaymentErrorBoundary } from '../hocs/withPaymentErrorBoundary';
