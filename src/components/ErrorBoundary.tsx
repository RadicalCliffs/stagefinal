import { Component } from 'react';
import type { ReactNode } from 'react';
import { globalErrorMonitor } from '../lib/debug-console';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Log to global error monitor for comprehensive tracking
    globalErrorMonitor.logError({
      type: 'error',
      message: error.message,
      stack: error.stack,
      context: {
        componentStack: errorInfo.componentStack,
        errorName: error.name
      },
      url: typeof window !== 'undefined' ? window.location.href : 'unknown'
    });

    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#1E1E1E] flex items-center justify-center px-4">
          <div className="max-w-md w-full bg-[#262626] border border-[#DDE404] rounded-lg p-8 text-center">
            <h2 className="text-2xl font-bold text-[#DDE404] mb-4 sequel-95">
              Something went wrong
            </h2>
            <p className="text-white/70 mb-4 sequel-45">
              We encountered an unexpected error. Please try refreshing the page.
            </p>
            {this.state.error && (
              <details className="text-left mb-4 text-xs">
                <summary className="text-white/50 cursor-pointer hover:text-white/70 sequel-45">
                  Error Details (for debugging)
                </summary>
                <div className="mt-2 p-3 bg-[#1E1E1E] rounded border border-white/10 overflow-auto max-h-40">
                  <p className="text-red-400 font-mono break-all">
                    {this.state.error.message}
                  </p>
                  {this.state.error.stack && (
                    <pre className="text-white/40 text-xs mt-2 whitespace-pre-wrap break-all">
                      {this.state.error.stack.split('\n').slice(0, 5).join('\n')}
                    </pre>
                  )}
                </div>
              </details>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="bg-[#DDE404] text-black px-6 py-3 rounded-lg sequel-75 hover:bg-[#c9cf04] transition-colors"
              >
                Refresh Page
              </button>
              <button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    (window as unknown as Record<string, () => void>).showErrorReport?.();
                  }
                }}
                className="bg-[#333] text-white px-6 py-3 rounded-lg sequel-75 hover:bg-[#444] transition-colors"
              >
                View Error Log
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
