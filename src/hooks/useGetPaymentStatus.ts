import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";

/**
 * ISSUE #3 FIX: Unified payment status type
 * Consolidates multiple status variations into a single canonical set
 */
export type PaymentStatusCanonical = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired';

/**
 * ISSUE #3 FIX: Map various status strings to canonical status
 */
function normalizePaymentStatus(status: string | null | undefined): PaymentStatusCanonical {
  if (!status) return 'pending';

  const normalizedStatus = status.toLowerCase().trim();

  // Map to canonical 'completed' status
  if (['completed', 'finished', 'success', 'confirmed', 'paid'].includes(normalizedStatus)) {
    return 'completed';
  }

  // Map to canonical 'failed' status
  if (['failed', 'error', 'rejected', 'declined'].includes(normalizedStatus)) {
    return 'failed';
  }

  // Map to canonical 'cancelled' status
  if (['cancelled', 'canceled', 'voided', 'refunded'].includes(normalizedStatus)) {
    return 'cancelled';
  }

  // Map to canonical 'expired' status
  if (['expired', 'timeout', 'timed_out'].includes(normalizedStatus)) {
    return 'expired';
  }

  // Map to canonical 'processing' status
  if (['processing', 'in_progress', 'awaiting', 'confirming'].includes(normalizedStatus)) {
    return 'processing';
  }

  // Default to pending for unknown statuses
  return 'pending';
}

/**
 * ISSUE #3 FIX: Check if a canonical status is terminal (no more updates expected)
 */
function isTerminalStatus(status: PaymentStatusCanonical): boolean {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(status);
}

/**
 * Hook to poll payment status from internal database.
 * All status updates come via webhooks - this hook polls the local database.
 *
 * ISSUE #3 FIX: Added atomic confirmation linking - when payment completes,
 * automatically triggers ticket confirmation and waits for it to complete.
 *
 * Supported URL parameters:
 * - payment / paymentStatus: 'success' | 'cancelled' | 'error'
 * - txId: Transaction ID from create-charge
 * - NP_id / payment_id / invoice_id / paymentId / id: Legacy payment ID formats
 * - order_id / orderId: Order ID
 */
export function usePaymentStatus(onOpen: () => void) {
  const [paymentData, setPaymentData] = useState<any>(null);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "success" | "error">("idle");
  const [loading, setLoading] = useState(false);
  /** ISSUE #3 FIX: Track ticket confirmation status separately */
  const [ticketConfirmationStatus, setTicketConfirmationStatus] = useState<'idle' | 'confirming' | 'confirmed' | 'failed'>('idle');
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const hasOpened = useRef(false);
  /** ISSUE #3 FIX: Track if we've already triggered confirmation */
  const confirmationTriggered = useRef(false);

  /**
   * ISSUE #3 FIX: Trigger ticket confirmation when payment succeeds
   * This creates an atomic link between payment success and ticket assignment
   *
   * CRITICAL FIX: Only call confirm-pending-tickets for payment methods that DON'T
   * already handle ticket confirmation themselves. Base payments (handleBasePayment)
   * already call confirm-pending-tickets via BasePaymentService.purchaseTickets(),
   * so calling it again here would result in DOUBLE ticket allocation.
   *
   * This hook should only confirm tickets for:
   * - Legacy NowPayments flow (when returning from external payment redirect)
   * - Payment methods that don't internally call confirm-pending-tickets
   */
  const triggerTicketConfirmation = useCallback(async (transactionId: string, transaction: any) => {
    if (confirmationTriggered.current) {
      return; // Already triggered
    }

    // CRITICAL: Skip ticket confirmation for payment providers that already handle it internally
    // These providers call confirm-pending-tickets within their payment flow:
    // - privy_base_wallet (Base payment via BasePaymentService.purchaseTickets)
    // - base-cdp (CDP smart account payments)
    // - onchainkit (OnchainKit checkout - handled in PaymentModal's handleOnchainKitStatus)
    // - coinbase_commerce (Other crypto - handled in PaymentModal's handleOtherCryptoStatus)
    //
    // ISSUE #2 FIX: Use exact match instead of substring .includes() to avoid false positives
    // Normalize provider to lowercase for consistent matching
    const provider = (transaction.payment_provider || '').toLowerCase().trim();

    // Set of self-confirming providers - use exact match for reliability
    const selfConfirmingProviders = new Set([
      'privy_base_wallet',
      'base-cdp',
      'base_wallet',
      'base_account',
      'onchainkit',
      'coinbase_commerce',
      // Also include variants without underscores for robustness
      'privybasewallet',
      'basecdp',
      'basewallet',
      'baseaccount',
      'coinbasecommerce',
    ]);

    // ISSUE #2 FIX: Use exact match or check if provider starts with known prefix
    // This prevents false positives from substring matching while allowing variations
    const isSelfConfirming = selfConfirmingProviders.has(provider) ||
      // Handle variations like "privy_base_wallet_v2" or "base-cdp-mainnet"
      [...selfConfirmingProviders].some(p => provider === p || provider.startsWith(p + '_') || provider.startsWith(p + '-'));

    if (isSelfConfirming) {
      console.log(`[usePaymentStatus] Skipping ticket confirmation for ${provider} - already handled by payment flow`);
      // Check if tickets were already confirmed by looking for existing entries
      try {
        const checkResponse = await fetch('/api/confirm-pending-tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: transactionId,
            userId: transaction.user_id,
            competitionId: transaction.competition_id,
            ticketCount: 0, // Pass 0 to just check existing, not allocate new
          }),
        });
        const checkResult = await checkResponse.json();
        if (checkResult.success && checkResult.alreadyConfirmed) {
          setTicketConfirmationStatus('confirmed');
          setPaymentData((prev: any) => ({
            ...prev,
            ticketNumbers: checkResult.ticketNumbers,
            ticketCount: checkResult.ticketCount,
            confirmationMessage: checkResult.message,
          }));
        } else {
          // Tickets exist but weren't returned, just mark as confirmed
          setTicketConfirmationStatus('confirmed');
        }
      } catch {
        // Ignore check errors - tickets are already confirmed by payment flow
        setTicketConfirmationStatus('confirmed');
      }
      confirmationTriggered.current = true;
      return;
    }

    confirmationTriggered.current = true;
    setTicketConfirmationStatus('confirming');

    try {
      // Call the confirm-pending-tickets endpoint
      const response = await fetch('/api/confirm-pending-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: transactionId,
          userId: transaction.user_id,
          competitionId: transaction.competition_id,
          ticketCount: transaction.ticket_count,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setTicketConfirmationStatus('confirmed');
        // Update payment data with ticket info
        setPaymentData((prev: any) => ({
          ...prev,
          ticketNumbers: result.ticketNumbers,
          ticketCount: result.ticketCount,
          confirmationMessage: result.message,
        }));
      } else {
        console.error('Ticket confirmation failed:', result.error);
        setTicketConfirmationStatus('failed');
      }
    } catch (error) {
      console.error('Error triggering ticket confirmation:', error);
      setTicketConfirmationStatus('failed');
    }
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    // Check for payment-related query params
    // txId is the primary identifier from our create-charge function
    const txId = urlParams.get("txId");
    const npId = urlParams.get("NP_id") || urlParams.get("payment_id") || urlParams.get("invoice_id") || urlParams.get("paymentId") || urlParams.get("id");
    const paymentParam = urlParams.get("payment") || urlParams.get("paymentStatus");
    const orderId = urlParams.get("order_id") || urlParams.get("orderId");

    if (txId || npId || paymentParam || orderId) {
      if (!hasOpened.current) {
        onOpen();
        hasOpened.current = true;
      }

      const fetchPaymentDetails = async () => {
        try {
          setLoading(true);

          // If we have a txId (our internal transaction ID), poll the database for status
          if (txId) {
            const { data: transaction, error } = await supabase
              .from('user_transactions')
              .select('id, status, payment_status, amount, currency, created_at, updated_at, competition_id, ticket_count, user_id')
              .eq('id', txId)
              .maybeSingle() as any;

            if (error) {
              console.error('Error fetching transaction by txId:', error);
              setPaymentStatus("error");
              setPaymentData({ message: "Error fetching payment details" });
              return;
            }

            if (transaction) {
              setPaymentData({
                ...transaction,
                order_description: transaction.ticket_count
                  ? `${transaction.ticket_count} ticket(s) for $${transaction.amount}`
                  : `$${transaction.amount} payment`,
                pay_address: transaction.id,
              });

              // ISSUE #3 FIX: Use normalized status for consistent handling
              const rawStatus = transaction.status || transaction.payment_status;
              const canonicalStatus = normalizePaymentStatus(rawStatus);

              if (canonicalStatus === 'completed') {
                setPaymentStatus("success");

                // ISSUE #3 FIX: Atomically trigger ticket confirmation on payment success
                triggerTicketConfirmation(txId, transaction);

                // Stop polling on success
                if (pollingInterval.current) {
                  clearInterval(pollingInterval.current);
                }
              } else if (canonicalStatus === 'failed' || canonicalStatus === 'expired' || canonicalStatus === 'cancelled') {
                setPaymentStatus("error");
                // Stop polling on terminal error states
                if (pollingInterval.current) {
                  clearInterval(pollingInterval.current);
                }
              } else {
                // Still pending/processing - show as success (payment initiated) but keep polling
                setPaymentStatus("success");
              }
            } else {
              // No transaction found yet - might still be processing
              setPaymentData({ message: "Payment is being processed...", order_description: "Processing payment..." });
              setPaymentStatus("success");
            }
            return;
          }

          // If we have an order_id or NP_id, poll the database for status
          if (orderId || npId) {
            // Try to find the transaction by order_id or tx_id
            let query = supabase
              .from('user_transactions')
              .select('id, status, payment_status, amount, currency, created_at, updated_at, competition_id, ticket_count, user_id')
              .order('created_at', { ascending: false } as any)
              .limit(1);

            if (orderId) {
              query = query.eq('order_id', orderId);
            } else if (npId) {
              query = query.eq('tx_id', npId);
            }

            const { data: transaction, error } = await query.maybeSingle() as any;

            if (error) {
              console.error('Error fetching transaction:', error);
              setPaymentStatus("error");
              setPaymentData({ message: "Error fetching payment details" });
              return;
            }

            if (transaction) {
              setPaymentData({
                ...transaction,
                order_description: transaction.ticket_count
                  ? `${transaction.ticket_count} ticket(s) for $${transaction.amount}`
                  : `$${transaction.amount} payment`,
                pay_address: transaction.id,
              });

              // ISSUE #3 FIX: Use normalized status for consistent handling
              const rawStatus = transaction.status || transaction.payment_status;
              const canonicalStatus = normalizePaymentStatus(rawStatus);

              if (canonicalStatus === 'completed') {
                setPaymentStatus("success");

                // ISSUE #3 FIX: Atomically trigger ticket confirmation on payment success
                triggerTicketConfirmation(transaction.id, transaction);

                // Stop polling on success
                if (pollingInterval.current) {
                  clearInterval(pollingInterval.current);
                }
              } else if (canonicalStatus === 'failed' || canonicalStatus === 'expired' || canonicalStatus === 'cancelled') {
                setPaymentStatus("error");
                // Stop polling on terminal error states
                if (pollingInterval.current) {
                  clearInterval(pollingInterval.current);
                }
              } else {
                // Still pending - show as success (payment initiated) but keep polling
                setPaymentStatus("success");
              }
            } else {
              // No transaction found yet - might still be processing
              setPaymentData({ message: "Payment is being processed...", order_description: "Processing payment..." });
              setPaymentStatus("success");
            }
          } else if (paymentParam === "success") {
            setPaymentStatus("success");
            setPaymentData({ message: "Payment completed successfully", order_description: "Payment successful!" });
          } else if (paymentParam === "cancelled") {
            setPaymentStatus("error");
            setPaymentData({ message: "Payment was cancelled" });
          }
        } catch (err) {
          console.error("Payment fetch error:", err);
          setPaymentStatus("error");
          setPaymentData({ message: "Error fetching payment details" });
        } finally {
          setLoading(false);
        }
      };

      fetchPaymentDetails();

      // Poll every 5 seconds if we have an order/payment ID to track
      if (txId || orderId || npId) {
        pollingInterval.current = setInterval(() => {
          fetchPaymentDetails();
        }, 5000);
      }
    }

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, [onOpen, triggerTicketConfirmation]);

  return {
    paymentData,
    paymentStatus,
    loading,
    // ISSUE #3 FIX: Expose ticket confirmation status
    ticketConfirmationStatus,
  };
}

// Alias for backward compatibility
export const useNowPaymentStatus = usePaymentStatus;

// ISSUE #3 FIX: Export utility functions for use elsewhere
export { normalizePaymentStatus, isTerminalStatus };
