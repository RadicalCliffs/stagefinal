/**
 * ReservationButton Component
 * 
 * Example component showing how to use guards and state machine for reliable reservations.
 * Implements UI interlocks to prevent double-spend and race conditions.
 */

import React, { useState } from 'react';
import { useEnhancedReservation } from '../hooks/useEnhancedReservation';

interface ReservationButtonProps {
  competitionId: string;
  ticketPrice: number;
  ticketNumbers: number[];
  onReservationComplete?: (reservationId: string) => void;
}

export function ReservationButton({
  competitionId,
  ticketPrice,
  ticketNumbers,
  onReservationComplete,
}: ReservationButtonProps) {
  const [isLocked, setIsLocked] = useState(false);

  const {
    state,
    error,
    isReady,
    canReserve,
    canPay,
    isProcessing,
    reserveTickets,
    initiatePayment,
    retryPayment,
    clearReservation,
    retrying,
  } = useEnhancedReservation({
    competitionId,
    ticketPrice,
    enableGuards: true,
  });

  // Single-flight mutex for reserve action
  const handleReserve = async () => {
    if (isLocked || !canReserve) {
      console.warn('[ReservationButton] Reserve action blocked - locked or cannot reserve');
      return;
    }

    setIsLocked(true);
    try {
      const result = await reserveTickets(ticketNumbers);
      if (result.success && result.reservationId) {
        onReservationComplete?.(result.reservationId);
      }
    } finally {
      setIsLocked(false);
    }
  };

  // Single-flight mutex for pay action
  const handlePay = async () => {
    if (isLocked || !canPay) {
      console.warn('[ReservationButton] Pay action blocked - locked or cannot pay');
      return;
    }

    setIsLocked(true);
    try {
      const result = await initiatePayment();
      if (!result.success) {
        console.error('[ReservationButton] Payment failed:', result.error);
      }
    } finally {
      setIsLocked(false);
    }
  };

  // Retry with same idempotency key
  const handleRetry = async () => {
    if (isLocked) {
      console.warn('[ReservationButton] Retry blocked - action in progress');
      return;
    }

    setIsLocked(true);
    try {
      await retryPayment();
    } finally {
      setIsLocked(false);
    }
  };

  // Reset and clear
  const handleReset = () => {
    if (!isLocked) {
      clearReservation();
    }
  };

  // Determine button state based on state machine
  const getButtonContent = () => {
    // Check if channels are ready
    if (!isReady.balances || !isReady.purchases) {
      return {
        text: 'Connecting...',
        disabled: true,
        variant: 'secondary' as const,
        action: () => {},
      };
    }

    switch (state.state) {
      case 'idle':
        return {
          text: 'Reserve Tickets',
          disabled: isLocked || !canReserve,
          variant: 'primary' as const,
          action: handleReserve,
        };

      case 'reserving':
        return {
          text: 'Reserving...',
          disabled: true,
          variant: 'secondary' as const,
          action: () => {},
        };

      case 'reserved':
        return {
          text: 'Proceed to Payment',
          disabled: isLocked || !canPay,
          variant: 'primary' as const,
          action: handlePay,
        };

      case 'paying':
        return {
          text: 'Processing Payment...',
          disabled: true,
          variant: 'secondary' as const,
          action: () => {},
        };

      case 'finalizing':
        return {
          text: 'Finalizing...',
          disabled: true,
          variant: 'secondary' as const,
          action: () => {},
        };

      case 'confirmed':
        return {
          text: 'Purchase Complete!',
          disabled: false,
          variant: 'success' as const,
          action: handleReset,
        };

      case 'failed':
        return {
          text: retrying ? 'Retrying safely...' : 'Retry Payment',
          disabled: isLocked || retrying,
          variant: 'warning' as const,
          action: handleRetry,
        };

      case 'expired':
        return {
          text: 'Reservation Expired',
          disabled: false,
          variant: 'warning' as const,
          action: handleReset,
        };

      default:
        return {
          text: 'Unknown State',
          disabled: true,
          variant: 'secondary' as const,
          action: () => {},
        };
    }
  };

  const button = getButtonContent();

  return (
    <div className="reservation-button-container">
      <button
        onClick={button.action}
        disabled={button.disabled}
        className={`btn btn-${button.variant}`}
        data-state={state.state}
        data-locked={isLocked}
      >
        {button.text}
      </button>

      {/* Error display */}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      {/* State indicator for debugging */}
      {process.env.NODE_ENV === 'development' && (
        <div className="debug-info">
          <small>
            State: {state.state} | Ready: {isReady.balances && isReady.purchases ? '✓' : '✗'} |
            Processing: {isProcessing ? 'Yes' : 'No'} | Locked: {isLocked ? 'Yes' : 'No'}
          </small>
        </div>
      )}
    </div>
  );
}
