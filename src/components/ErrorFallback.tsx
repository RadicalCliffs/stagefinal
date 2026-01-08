interface ErrorFallbackProps {
  error?: Error | string;
  message?: string;
  onRetry?: () => void;
}

export default function ErrorFallback({ error, message, onRetry }: ErrorFallbackProps) {
  const errorMessage = message || (error instanceof Error ? error.message : error) || 'Something went wrong';

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-[#262626] border border-red-500 rounded-lg p-6 text-center">
        <div className="text-red-500 mb-4">
          <svg
            className="w-12 h-12 mx-auto"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white mb-2 sequel-75">Error</h3>
        <p className="text-white/70 mb-6 sequel-45 text-sm">{errorMessage}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="bg-[#DDE404] text-black px-6 py-2 rounded-lg sequel-75 hover:bg-[#c9cf04] transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}
