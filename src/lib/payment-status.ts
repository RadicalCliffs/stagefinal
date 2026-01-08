/**
 * Payment Status Utility
 *
 * Provides centralized, consistent status normalization across all payment methods.
 * This ensures that all payment providers (Coinbase Commerce, Base USDC,
 * Coinbase Onramp, Balance payments) use the same status values and terminal state detection.
 *
 * Usage:
 *   import { isSuccessStatus, isFailureStatus, normalizePaymentStatus } from './payment-status';
 *
 *   if (isSuccessStatus(status)) { ... }
 */

/**
 * All statuses that indicate a successful/completed payment.
 * These values may come from different payment providers:
 * - 'completed': Base USDC, Balance payments
 * - 'finished': Legacy/webhook-based
 * - 'confirmed': Coinbase Commerce
 * - 'success': Generic success
 * - 'paid': Webhook-based confirmations
 */
export const SUCCESS_STATUSES = ['completed', 'finished', 'confirmed', 'success', 'paid'] as const;

/**
 * All statuses that indicate a failed/terminal-failure payment.
 * - 'failed': All providers
 * - 'expired': Timeouts
 * - 'cancelled': User cancelled
 * - 'unresolved': Coinbase Commerce (underpaid/overpaid)
 * - 'error': Generic error
 * - 'refunded': Post-payment refund
 */
export const FAILURE_STATUSES = ['failed', 'expired', 'cancelled', 'unresolved', 'error', 'refunded'] as const;

/**
 * Statuses that indicate payment is being processed (not yet terminal).
 * - 'processing': Generic processing
 * - 'confirming': Waiting for blockchain confirmations
 * - 'sending': Blockchain transfer in progress
 * - 'pending': Waiting for payment
 * - 'delayed': Coinbase Commerce
 * - 'partially_paid': Partial payment received
 */
export const PROCESSING_STATUSES = ['processing', 'confirming', 'sending', 'pending', 'delayed', 'partially_paid'] as const;

export type SuccessStatus = typeof SUCCESS_STATUSES[number];
export type FailureStatus = typeof FAILURE_STATUSES[number];
export type ProcessingStatus = typeof PROCESSING_STATUSES[number];
export type NormalizedStatus = 'completed' | 'failed' | 'processing' | 'pending';

/**
 * Check if a status indicates successful payment completion.
 * Case-insensitive: 'COMPLETED', 'Completed', 'completed' all match.
 */
export function isSuccessStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase().trim();
  return SUCCESS_STATUSES.includes(normalized as SuccessStatus);
}

/**
 * Check if a status indicates payment failure.
 * Case-insensitive: 'FAILED', 'Failed', 'failed' all match.
 */
export function isFailureStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase().trim();
  return FAILURE_STATUSES.includes(normalized as FailureStatus);
}

/**
 * Check if a status indicates payment is still processing.
 * Case-insensitive: 'PROCESSING', 'Processing', 'processing' all match.
 */
export function isProcessingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase().trim();
  return PROCESSING_STATUSES.includes(normalized as ProcessingStatus);
}

/**
 * Check if a status is terminal (either success or failure - no more changes expected).
 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  return isSuccessStatus(status) || isFailureStatus(status);
}

/**
 * Normalize any payment status to a consistent value.
 *
 * @param status - Raw status from any payment provider
 * @returns Normalized status: 'completed' | 'failed' | 'processing' | 'pending'
 */
export function normalizePaymentStatus(status: string | null | undefined): NormalizedStatus {
  if (!status) return 'pending';

  if (isSuccessStatus(status)) {
    return 'completed';
  }

  if (isFailureStatus(status)) {
    return 'failed';
  }

  if (isProcessingStatus(status)) {
    return 'processing';
  }

  return 'pending';
}

/**
 * Default polling configuration for payment status checks.
 * Aligned across all payment methods for consistency.
 */
export const POLLING_CONFIG = {
  /** Maximum number of polling attempts before timeout */
  maxAttempts: 60,
  /** Interval between polls in milliseconds (5 seconds) */
  intervalMs: 5000,
  /** Total timeout duration in milliseconds (5 minutes) */
  get timeoutMs() {
    return this.maxAttempts * this.intervalMs;
  },
} as const;
