/**
 * Base Pay Button Component
 * 
 * A button component that initiates Base Account payments.
 * When clicked, it opens the Base Account payment popup for seamless USDC payments.
 * 
 * Features:
 * - One-tap payment experience
 * - No wallet connection required upfront
 * - Branded with Base colors for consistency
 */

import { useState } from 'react';

interface BasePayButtonProps {
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Click handler */
  onClick: () => void | Promise<void>;
  /** Button text */
  children?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Button variant */
  variant?: 'primary' | 'secondary';
}

export function BasePayButton({
  disabled = false,
  loading = false,
  onClick,
  children = 'Pay with Base',
  className = '',
  variant = 'primary',
}: BasePayButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleClick = async () => {
    if (disabled || loading || isProcessing) return;

    setIsProcessing(true);
    try {
      await onClick();
    } finally {
      setIsProcessing(false);
    }
  };

  const isLoading = loading || isProcessing;

  // Base brand colors
  const baseColors = variant === 'primary'
    ? 'bg-[#0052FF] hover:bg-[#0042CC] text-white'
    : 'bg-white hover:bg-gray-100 text-[#0052FF] border-2 border-[#0052FF]';

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading}
      type="button"
      className={`
        ${baseColors}
        disabled:opacity-50 disabled:cursor-not-allowed
        w-full uppercase text-sm sm:text-base sequel-95
        px-6 py-2.5 sm:px-8 sm:py-3
        cursor-pointer rounded-lg
        transition-all duration-200
        flex items-center justify-center gap-2
        ${className}
      `}
    >
      {isLoading ? (
        <>
          <svg
            className="animate-spin h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Processing...</span>
        </>
      ) : (
        <>
          <BaseLogo className="w-5 h-5" />
          <span>{children}</span>
        </>
      )}
    </button>
  );
}

/**
 * Base logo SVG component
 */
function BaseLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 111 111"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H3.9565e-07C2.35281 87.8625 26.0432 110.034 54.921 110.034Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default BasePayButton;
