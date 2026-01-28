/**
 * Guard Types
 * 
 * Type definitions for balance and reservation guards
 */

export interface BalanceSnapshot {
  user_id: string;
  available: number;
  pending: number;
  currency?: string;
  version?: number; // or use updated_at
  updated_at?: string;
}

export interface ReservationRow {
  id: string; // reservation_id (uuid)
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  competition_id: string;
  canonical_user_id: string;
  total_amount: number;
  expires_at: string; // ISO timestamp
  created_at?: string;
}

export interface PurchaseEvent {
  type: 'reservation_created' | 'payment_authorized' | 'purchase_confirmed' | 'reservation_failed';
  reservation_id: string;
  total_amount?: number;
  version?: number;
  updated_at?: string;
}

export type ReservationState =
  | 'idle'
  | 'reserving'
  | 'reserved'
  | 'paying'
  | 'finalizing'
  | 'confirmed'
  | 'failed'
  | 'expired';

export interface ReservationStateMachine {
  state: ReservationState;
  reservationId: string | null;
  totalAmount: number;
  idempotencyKey: string | null;
  lastUpdate: Date;
  error: string | null;
}
