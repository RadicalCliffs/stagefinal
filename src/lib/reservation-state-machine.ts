/**
 * Reservation State Machine
 * 
 * Manages the state transitions for ticket reservations and purchases.
 * Ensures operations follow the correct flow and handle edge cases.
 */

import type { ReservationState, ReservationStateMachine } from './guards/types';

type StateTransition =
  | { from: 'idle'; to: 'reserving'; trigger: 'RESERVE_STARTED' }
  | { from: 'reserving'; to: 'reserved'; trigger: 'RESERVATION_CREATED' }
  | { from: 'reserving'; to: 'failed'; trigger: 'RESERVATION_FAILED' }
  | { from: 'reserved'; to: 'paying'; trigger: 'PAYMENT_STARTED' }
  | { from: 'reserved'; to: 'expired'; trigger: 'RESERVATION_EXPIRED' }
  | { from: 'paying'; to: 'finalizing'; trigger: 'PAYMENT_AUTHORIZED' }
  | { from: 'paying'; to: 'failed'; trigger: 'PAYMENT_FAILED' }
  | { from: 'finalizing'; to: 'confirmed'; trigger: 'PURCHASE_CONFIRMED' }
  | { from: 'finalizing'; to: 'failed'; trigger: 'FINALIZE_FAILED' }
  | { from: 'failed'; to: 'idle'; trigger: 'RESET' }
  | { from: 'expired'; to: 'idle'; trigger: 'RESET' }
  | { from: 'confirmed'; to: 'idle'; trigger: 'RESET' };

const VALID_TRANSITIONS: StateTransition[] = [
  { from: 'idle', to: 'reserving', trigger: 'RESERVE_STARTED' },
  { from: 'reserving', to: 'reserved', trigger: 'RESERVATION_CREATED' },
  { from: 'reserving', to: 'failed', trigger: 'RESERVATION_FAILED' },
  { from: 'reserved', to: 'paying', trigger: 'PAYMENT_STARTED' },
  { from: 'reserved', to: 'expired', trigger: 'RESERVATION_EXPIRED' },
  { from: 'paying', to: 'finalizing', trigger: 'PAYMENT_AUTHORIZED' },
  { from: 'paying', to: 'failed', trigger: 'PAYMENT_FAILED' },
  { from: 'finalizing', to: 'confirmed', trigger: 'PURCHASE_CONFIRMED' },
  { from: 'finalizing', to: 'failed', trigger: 'FINALIZE_FAILED' },
  { from: 'failed', to: 'idle', trigger: 'RESET' },
  { from: 'expired', to: 'idle', trigger: 'RESET' },
  { from: 'confirmed', to: 'idle', trigger: 'RESET' },
];

export class ReservationStateMachineManager {
  private state: ReservationStateMachine;
  private listeners: Set<(state: ReservationStateMachine) => void> = new Set();

  constructor() {
    this.state = {
      state: 'idle',
      reservationId: null,
      totalAmount: 0,
      idempotencyKey: null,
      lastUpdate: new Date(),
      error: null,
    };
  }

  /**
   * Get current state
   */
  getState(): ReservationStateMachine {
    return { ...this.state };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: ReservationStateMachine) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Transition to a new state
   */
  transition(
    trigger: StateTransition['trigger'],
    data?: {
      reservationId?: string;
      totalAmount?: number;
      idempotencyKey?: string;
      error?: string;
    }
  ): boolean {
    const currentState = this.state.state;
    const validTransition = VALID_TRANSITIONS.find(
      (t) => t.from === currentState && t.trigger === trigger
    );

    if (!validTransition) {
      console.warn(
        `[ReservationStateMachine] Invalid transition: ${currentState} -> ${trigger}`
      );
      return false;
    }

    const newState = validTransition.to;
    console.log(
      `[ReservationStateMachine] Transition: ${currentState} -> ${newState} (${trigger})`
    );

    this.state = {
      ...this.state,
      state: newState,
      reservationId: data?.reservationId ?? this.state.reservationId,
      totalAmount: data?.totalAmount ?? this.state.totalAmount,
      idempotencyKey: data?.idempotencyKey ?? this.state.idempotencyKey,
      error: data?.error ?? null,
      lastUpdate: new Date(),
    };

    // Notify listeners
    this.notifyListeners();

    return true;
  }

  /**
   * Reset to idle state
   */
  reset(): void {
    this.transition('RESET');
    this.state.reservationId = null;
    this.state.totalAmount = 0;
    this.state.idempotencyKey = null;
    this.state.error = null;
    this.notifyListeners();
  }

  /**
   * Check if an operation is allowed in the current state
   */
  canReserve(): boolean {
    return this.state.state === 'idle';
  }

  canPay(): boolean {
    return this.state.state === 'reserved';
  }

  canFinalize(): boolean {
    return this.state.state === 'paying';
  }

  isProcessing(): boolean {
    return ['reserving', 'paying', 'finalizing'].includes(this.state.state);
  }

  isTerminal(): boolean {
    return ['confirmed', 'failed', 'expired'].includes(this.state.state);
  }

  /**
   * Start reservation process
   */
  startReservation(totalAmount: number): boolean {
    if (!this.canReserve()) {
      console.warn('[ReservationStateMachine] Cannot reserve in current state:', this.state.state);
      return false;
    }

    return this.transition('RESERVE_STARTED', { totalAmount });
  }

  /**
   * Mark reservation as created
   */
  reservationCreated(reservationId: string): boolean {
    return this.transition('RESERVATION_CREATED', { reservationId });
  }

  /**
   * Mark reservation as failed
   */
  reservationFailed(error: string): boolean {
    return this.transition('RESERVATION_FAILED', { error });
  }

  /**
   * Start payment process
   */
  startPayment(idempotencyKey: string): boolean {
    if (!this.canPay()) {
      console.warn('[ReservationStateMachine] Cannot pay in current state:', this.state.state);
      return false;
    }

    return this.transition('PAYMENT_STARTED', { idempotencyKey });
  }

  /**
   * Mark payment as authorized
   */
  paymentAuthorized(): boolean {
    return this.transition('PAYMENT_AUTHORIZED');
  }

  /**
   * Mark payment as failed
   */
  paymentFailed(error: string): boolean {
    return this.transition('PAYMENT_FAILED', { error });
  }

  /**
   * Mark purchase as confirmed
   */
  purchaseConfirmed(): boolean {
    return this.transition('PURCHASE_CONFIRMED');
  }

  /**
   * Mark finalization as failed
   */
  finalizeFailed(error: string): boolean {
    return this.transition('FINALIZE_FAILED', { error });
  }

  /**
   * Mark reservation as expired
   */
  reservationExpired(): boolean {
    return this.transition('RESERVATION_EXPIRED', { error: 'Reservation expired' });
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.getState());
      } catch (err) {
        console.error('[ReservationStateMachine] Listener error:', err);
      }
    });
  }
}
