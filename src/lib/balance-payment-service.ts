/**
 * Balance Payment Service
 *
 * Simplified balance payment system that uses the Edge Function + RPC flow:
 * 1. Optional: Reserve tickets via Supabase edge function (for frontend UX)
 * 2. Purchase with balance via POST /functions/v1/purchase-with-balance (Edge Function)
 *    - The Edge Function calls purchase_tickets_with_balance RPC which:
 *      - Checks sub_account_balances for available_balance
 *      - Matches by canonical_user_id or wallet_address
 *      - Deducts balance atomically
 *      - Allocates tickets (selected or lucky dip)
 *      - Returns success with balance and ticket info
 *
 * This replaces all previous complex balance payment logic.
 */

import { supabase } from "./supabase";
import { toCanonicalUserId } from "./canonicalUserId";
import { idempotencyKeyManager } from "./idempotency-keys";
import {
  getPurchaseStatusByKey,
  verifyCompetitionPurchase,
  rescuePurchaseAttempt,
} from "./supabase-rpc-helpers";
import type {
  PurchaseStatusByKeyResponse,
  VerifyCompetitionPurchaseResponse,
  RescuePurchaseAttemptResponse,
} from "@/types/purchase-tickets";

// ============================================================================
// Types
// ============================================================================

export interface ReservationRequest {
  competition_id: string;
  canonical_user_id: string;
  ticket_numbers?: number[];
  ticket_count?: number;
  idempotency_key: string;
}

export interface ReservationResponse {
  reservation_id: string;
  competition_id: string;
  ticket_numbers: number[];
  ticket_count: number;
  ticket_price: string;
  total_amount: string;
  expires_at: string;
}

export interface PurchaseRequest {
  reservation_id: string;
  idempotency_key: string;
  // Best practice: include all required data directly, don't rely on lookups
  competition_id?: string;
  canonical_user_id?: string;
  ticket_numbers?: number[];
  ticket_count?: number;
  ticket_price?: number;
}

/**
 * Purchase request body for /functions/v1/purchase-with-balance (Edge Function)
 * IMPORTANT: Field names must match what the Edge Function expects (NOT p_ prefixed)
 */
export interface RPCPurchaseRequest {
  /** Canonical user identifier (e.g., prize:pid:0x123...) */
  canonical_user_id: string;

  /** Competition UUID */
  competition_id: string;

  /** Array of ticket numbers */
  ticket_numbers: number[];

  /** Ticket price - REQUIRED by RPC function */
  ticket_price: number;

  /** Idempotency key for deduplication */
  idempotency_key?: string;

  /** Optional reservation ID */
  reservation_id?: string | null;

  /** Original wallet address (e.g., 0x123...) - fallback identifier */
  wallet_address?: string | null;
}

/**
 * Verify and rescue request body for https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-handler/verify-and-rescue-purchase (Edge Function)
 */
export interface RPCVerifyAndRescueRequest {
  /** Canonical user identifier */
  p_user_identifier: string;

  /** Competition UUID */
  p_competition_id: string;

  /** Array of ticket numbers to rescue */
  p_ticket_numbers: number[];

  /** Ticket price in USD */
  p_ticket_price: number;

  /** Idempotency key */
  p_idempotency_key: string;
}

/**
 * @deprecated Legacy request interface - use RPCPurchaseRequest instead
 * Purchase request body for old Netlify proxy endpoint
 */
export interface EdgeFunctionPurchaseRequest {
  userId: string;
  competition_id: string;
  numberOfTickets: number;
  ticketPrice: number;
  tickets: Array<{ ticket_number: number }>;
  idempotent: boolean;
  reservation_id?: string;
  idempotency_key?: string;
  payment_provider?: string;
  type?: string;
}

export interface PurchaseResponse {
  payment_id: string;
  status: "succeeded";
  amount: string;
  currency: string;
  new_balance: string;
  competition_id: string;
  tickets: Array<{ id: string; ticket_number: number }>;
}

export interface VerifyRequest {
  reservation_id?: string;
  payment_id?: string;
}

export interface BalancePaymentError {
  statusCode: number;
  message: string;
  type?:
    | "validation"
    | "conflict"
    | "expired"
    | "insufficient_balance"
    | "not_found"
    | "network"
    | "unknown";
  code?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique idempotency key using cryptographically secure random
 * @deprecated Use idempotencyKeyManager.getOrCreateKey() instead for automatic reuse on retries
 */
function generateIdempotencyKey(prefix: string): string {
  return crypto.randomUUID();
}

/**
 * Parse error response from edge function
 */
function parseError(error: any, statusCode?: number): BalancePaymentError {
  const message = error?.message || error?.error || String(error);
  const code = statusCode || error?.statusCode || 500;

  let type: BalancePaymentError["type"] = "unknown";

  if (code === 400 || code === 422) {
    type = "validation";
  } else if (code === 409) {
    type = "conflict";
  } else if (code === 410) {
    type = "expired";
  } else if (code === 402) {
    type = "insufficient_balance";
  } else if (code === 404) {
    type = "not_found";
  } else if (message.includes("network") || message.includes("Network")) {
    type = "network";
  }

  return {
    statusCode: code,
    message,
    type,
  };
}

/**
 * Get user-friendly error message
 */
function getUserFriendlyError(error: BalancePaymentError): string {
  switch (error.type) {
    case "validation":
      return (
        error.message ||
        "Invalid request. Please check your input and try again."
      );
    case "conflict":
      return "Some tickets are no longer available. Please select different tickets.";
    case "expired":
      return "Your reservation has expired. Please reserve tickets again.";
    case "insufficient_balance":
      return "Insufficient balance. Please top up your wallet and try again.";
    case "not_found":
      return "Reservation not found. Please reserve tickets again.";
    case "network":
      return "Network error. Please check your connection and try again.";
    default:
      return error.message || "An unexpected error occurred. Please try again.";
  }
}

// ============================================================================
// Main Service Class
// ============================================================================

export class BalancePaymentService {
  /**
   * Step 1: Reserve tickets
   *
   * Creates a hold via pending_tickets and pending_ticket_items.
   * Returns a reservation_id that expires after expires_at.
   *
   * @param params.userId - User identifier (will be converted to canonical format)
   * @param params.competitionId - Competition UUID
   * @param params.ticketNumbers - Optional: Specific ticket numbers to reserve (e.g., [1, 5, 10])
   * @param params.ticketCount - Optional: Number of tickets to auto-select (cannot use with ticketNumbers)
   * @returns Promise with reservation data or error
   */
  static async reserveTickets(params: {
    userId: string;
    competitionId: string;
    ticketNumbers?: number[];
    ticketCount?: number;
  }): Promise<{
    success: boolean;
    data?: ReservationResponse;
    error?: string;
    errorDetails?: BalancePaymentError;
  }> {
    const { userId, competitionId, ticketNumbers, ticketCount } = params;

    // Validate inputs
    if (!userId || !competitionId) {
      return {
        success: false,
        error: "User ID and Competition ID are required",
      };
    }

    if ((!ticketNumbers || ticketNumbers.length === 0) && !ticketCount) {
      return {
        success: false,
        error: "Provide either ticket_numbers or ticket_count",
      };
    }

    if (ticketNumbers && ticketNumbers.length > 0 && ticketCount) {
      return {
        success: false,
        error: "Send either ticket_numbers or ticket_count, not both",
      };
    }

    // Validate ticketCount is positive
    if (
      ticketCount !== undefined &&
      (ticketCount <= 0 || !Number.isFinite(ticketCount))
    ) {
      return {
        success: false,
        error: "Ticket count must be a positive number",
      };
    }

    try {
      const canonicalUserId = toCanonicalUserId(userId);

      // Use idempotency manager for proper key management with automatic reuse on retries
      const idempotencyKey = idempotencyKeyManager.getOrCreateKey(
        `reserve-${competitionId}-${Date.now()}`,
      );

      const requestBody: ReservationRequest = {
        competition_id: competitionId,
        canonical_user_id: canonicalUserId,
        idempotency_key: idempotencyKey,
      };

      if (ticketNumbers && ticketNumbers.length > 0) {
        requestBody.ticket_numbers = ticketNumbers;
      } else if (ticketCount) {
        requestBody.ticket_count = ticketCount;
      }

      console.log("[BalancePayment] Reserving tickets:", requestBody);

      const { data, error } = await supabase.functions.invoke(
        "reserve-tickets",
        {
          body: requestBody,
        },
      );

      if (error) {
        const parsedError = parseError(error);
        console.error("[BalancePayment] Reservation error:", parsedError);
        return {
          success: false,
          error: getUserFriendlyError(parsedError),
          errorDetails: parsedError,
        };
      }

      if (!data || !data.reservation_id) {
        return {
          success: false,
          error: "Invalid response from server",
        };
      }

      console.log(
        "[BalancePayment] Reservation successful:",
        data.reservation_id,
      );

      return {
        success: true,
        data: data as ReservationResponse,
      };
    } catch (error) {
      console.error("[BalancePayment] Reservation exception:", error);
      const parsedError = parseError(error);
      return {
        success: false,
        error: getUserFriendlyError(parsedError),
        errorDetails: parsedError,
      };
    }
  }

  /**
   * Step 2: Purchase with balance (SIMPLIFIED SYSTEM)
   *
   * Uses the Edge Function at /functions/v1/purchase-with-balance which calls
   * the purchase_tickets_with_balance RPC that:
   * - Checks sub_account_balances for available_balance
   * - Matches user by canonical_user_id or wallet_address
   * - Atomically deducts balance and creates tickets
   * - Returns: { status: 'ok', competition_id, tickets, entry_id, total_cost, new_balance }
   *
   * @param params.competitionId - Competition UUID (REQUIRED)
   * @param params.ticketNumbers - Specific ticket numbers to purchase (REQUIRED)
   * @param params.userId - User identifier (REQUIRED)
   * @param params.ticketPrice - Ticket price (REQUIRED)
   * @param params.reservationId - Optional reservation ID (for backwards compatibility)
   * @param params.ticketCount - Optional count (for backwards compatibility)
   * @returns Promise with purchase data including new balance
   */
  static async purchaseWithBalance(params: {
    competitionId: string;
    ticketNumbers: number[];
    userId: string;
    ticketPrice: number;
    reservationId?: string;
    ticketCount?: number;
  }): Promise<{
    success: boolean;
    data?: PurchaseResponse;
    error?: string;
    errorDetails?: BalancePaymentError;
  }> {
    const { competitionId, ticketNumbers, userId, ticketPrice, reservationId } =
      params;

    // Validate required parameters
    if (!competitionId) {
      return {
        success: false,
        error: "Competition ID is required",
      };
    }

    if (!ticketNumbers || ticketNumbers.length === 0) {
      return {
        success: false,
        error: "Ticket numbers are required",
      };
    }

    if (!userId) {
      return {
        success: false,
        error: "User ID is required",
      };
    }

    if (ticketPrice < 0.1 || ticketPrice > 100) {
      return {
        success: false,
        error: "Ticket price must be between $0.10 and $100",
      };
    }

    try {
      // Convert userId to canonical format
      const canonicalUserId = toCanonicalUserId(userId);

      // Use idempotency manager for proper key management
      const idempotencyKeyBase =
        reservationId || `purchase-${competitionId}-${Date.now()}`;
      const idempotencyKey =
        idempotencyKeyManager.getOrCreateKey(idempotencyKeyBase);

      console.log("[BalancePayment] Purchasing with balance (2-step flow):", {
        userId:
          canonicalUserId.length > 20
            ? canonicalUserId.substring(0, 20) + "..."
            : canonicalUserId,
        competitionId: competitionId.substring(0, 10) + "...",
        ticketCount: ticketNumbers.length,
        ticketPrice: ticketPrice,
        reservationId: reservationId || "none",
      });

      // =====================================================
      // WORKING 2-STEP APPROACH:
      // 1. Allocate tickets via allocate_lucky_dip_tickets_batch
      // 2. Confirm pending_tickets + deduct balance
      // =====================================================

      // Calculate total amount
      const totalAmount = ticketNumbers.length * ticketPrice;

      // Step 0: Check balance FIRST before doing anything
      console.log("[BalancePayment] Checking balance...");
      const { data: balanceData } = await supabase
        .from("sub_account_balances")
        .select("available_balance")
        .eq("canonical_user_id", canonicalUserId)
        .eq("currency", "USD")
        .single();

      const currentBalance = balanceData?.available_balance ?? 0;
      if (currentBalance < totalAmount) {
        console.error(
          "[BalancePayment] Insufficient balance:",
          currentBalance,
          "<",
          totalAmount,
        );
        return {
          success: false,
          error: "Insufficient balance",
          errorDetails: {
            code: "INSUFFICIENT_BALANCE",
            message: `Need $${totalAmount.toFixed(2)}, have $${currentBalance.toFixed(2)}`,
            statusCode: 402,
          },
        };
      }

      // Step 1: Allocate tickets (if no reservation provided)
      let actualReservationId = reservationId;
      let actualTicketNumbers = ticketNumbers;

      if (!reservationId) {
        console.log("[BalancePayment] Step 1: Allocating tickets...");
        const { data: allocData, error: allocError } = await supabase.rpc(
          "allocate_lucky_dip_tickets_batch",
          {
            p_user_id: canonicalUserId,
            p_competition_id: competitionId,
            p_count: ticketNumbers.length,
            p_ticket_price: ticketPrice,
            p_hold_minutes: 15,
            p_session_id: idempotencyKey,
            p_excluded_tickets: undefined,
          },
        );

        const allocResult = allocData as {
          success?: boolean;
          error?: string;
          reservation_id?: string;
          ticket_numbers?: number[];
        } | null;
        if (allocError || !allocResult?.success) {
          const errMsg =
            allocError?.message ||
            allocResult?.error ||
            "Failed to reserve tickets";
          console.error("[BalancePayment] Allocation failed:", errMsg);
          return {
            success: false,
            error: errMsg,
            errorDetails: {
              code: "ALLOCATION_FAILED",
              message: errMsg,
              statusCode: 400,
            },
          };
        }

        actualReservationId = allocResult.reservation_id;
        actualTicketNumbers = allocResult.ticket_numbers || ticketNumbers;
        console.log(
          "[BalancePayment] Allocated tickets:",
          actualTicketNumbers,
          "Reservation ID:",
          actualReservationId,
        );
      }

      // Step 2: Confirm the pending_tickets (trigger creates tickets automatically)
      console.log("[BalancePayment] Step 2: Confirming reservation...");

      if (!actualReservationId) {
        console.error("[BalancePayment] No reservation ID available");
        return {
          success: false,
          error: "No reservation ID",
          errorDetails: {
            code: "NO_RESERVATION_ID",
            message: "Missing reservation ID",
            statusCode: 500,
          },
        };
      }

      // Extract wallet address for fallback lookup
      const walletAddress = userId.startsWith("0x")
        ? userId.toLowerCase()
        : canonicalUserId.startsWith("prize:pid:0x")
          ? canonicalUserId.substring(10).toLowerCase()
          : null;

      const { error: confirmError } = await supabase
        .from("pending_tickets")
        .update({
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
          canonical_user_id: canonicalUserId,
          wallet_address: walletAddress, // For dashboard fallback lookup
        })
        .eq("id", actualReservationId);

      if (confirmError) {
        console.error("[BalancePayment] Confirm failed:", confirmError.message);
        return {
          success: false,
          error: "Failed to confirm reservation",
          errorDetails: {
            code: "CONFIRM_FAILED",
            message: confirmError.message,
            statusCode: 500,
          },
        };
      }

      // Step 3: Deduct balance
      console.log("[BalancePayment] Step 3: Deducting balance...");
      const newBalance = currentBalance - totalAmount;

      const { error: balanceError } = await supabase
        .from("sub_account_balances")
        .update({
          available_balance: newBalance,
          last_updated: new Date().toISOString(),
        })
        .eq("canonical_user_id", canonicalUserId)
        .eq("currency", "USD");

      if (balanceError) {
        console.error(
          "[BalancePayment] Balance deduction failed:",
          balanceError.message,
        );
        return {
          success: false,
          error: "Failed to deduct balance",
          errorDetails: {
            code: "BALANCE_DEDUCTION_FAILED",
            message: balanceError.message,
            statusCode: 500,
          },
        };
      }

      // Step 4: Record ledger entry (non-blocking)
      Promise.resolve(
        supabase.from("balance_ledger").insert({
          canonical_user_id: canonicalUserId,
          transaction_type: "debit",
          amount: totalAmount,
          currency: "USD",
          balance_before: currentBalance,
          balance_after: newBalance,
          reference_id: actualReservationId,
          description: `Ticket purchase - ${actualTicketNumbers.length} tickets`,
        }),
      )
        .then(() => {
          console.log("[BalancePayment] Ledger entry recorded");
        })
        .catch((err: unknown) => {
          console.warn(
            "[BalancePayment] Ledger entry failed (non-critical):",
            err,
          );
        });

      console.log("[BalancePayment] ✓ Purchase completed successfully!");

      // Transform response
      const transformedData: PurchaseResponse = {
        payment_id:
          actualReservationId ||
          "purchase-" + Date.now() + "-" + crypto.randomUUID(),
        status: "succeeded",
        amount: String(totalAmount),
        currency: "USD",
        new_balance: String(newBalance),
        competition_id: competitionId,
        tickets: actualTicketNumbers.map((num: number, index: number) => ({
          id: actualReservationId
            ? `${actualReservationId}-${index}`
            : `ticket-${index}`,
          ticket_number: num,
        })),
      };

      // Dispatch balance-updated event
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("balance-updated", {
            detail: {
              newBalance: newBalance,
              purchaseAmount: totalAmount,
              tickets: transformedData.tickets,
              competitionId: competitionId,
            },
          }),
        );
      }

      // Mark idempotency key as terminal
      idempotencyKeyManager.markTerminal(idempotencyKeyBase);

      return {
        success: true,
        data: transformedData,
      };
    } catch (error) {
      console.error("[BalancePayment] Purchase exception:", error);
      const parsedError = parseError(error);
      return {
        success: false,
        error: getUserFriendlyError(parsedError),
        errorDetails: parsedError,
      };
    }
  }

  /**
   * Step 3: Verify status (optional)
   *
   * Read-only status check for a reservation or payment.
   * Use only if the purchase response was lost/uncertain.
   */
  static async verifyPaymentStatus(params: {
    reservationId?: string;
    paymentId?: string;
  }): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    const { reservationId, paymentId } = params;

    if (!reservationId && !paymentId) {
      return {
        success: false,
        error: "Provide either reservation_id or payment_id",
      };
    }

    try {
      const requestBody: VerifyRequest = {};
      if (reservationId) requestBody.reservation_id = reservationId;
      if (paymentId) requestBody.payment_id = paymentId;

      console.log("[BalancePayment] Verifying status:", requestBody);

      const { data, error } = await supabase.functions.invoke(
        "process-balance-payments",
        {
          body: requestBody,
        },
      );

      if (error) {
        const parsedError = parseError(error);
        console.error("[BalancePayment] Verify error:", parsedError);
        return {
          success: false,
          error: getUserFriendlyError(parsedError),
        };
      }

      console.log("[BalancePayment] Verification result:", data);

      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error("[BalancePayment] Verify exception:", error);
      const parsedError = parseError(error);
      return {
        success: false,
        error: getUserFriendlyError(parsedError),
      };
    }
  }

  /**
   * Complete flow: Reserve and Purchase
   *
   * Convenience method that combines reservation and purchase in one call.
   * Handles the common case of immediate purchase after reservation.
   */
  static async reserveAndPurchase(params: {
    userId: string;
    competitionId: string;
    ticketPrice: number;
    ticketNumbers?: number[];
    ticketCount?: number;
  }): Promise<{
    success: boolean;
    reservationData?: ReservationResponse;
    purchaseData?: PurchaseResponse;
    error?: string;
    step?: "reserve" | "purchase";
  }> {
    // Step 1: Reserve
    const reserveResult = await this.reserveTickets(params);

    if (!reserveResult.success || !reserveResult.data) {
      return {
        success: false,
        error: reserveResult.error,
        step: "reserve",
      };
    }

    const reservationData = reserveResult.data;

    // Step 2: Purchase with required parameters
    const purchaseResult = await this.purchaseWithBalance({
      competitionId: params.competitionId,
      ticketNumbers: reservationData.ticket_numbers,
      userId: params.userId,
      ticketPrice: params.ticketPrice,
    });

    if (!purchaseResult.success) {
      return {
        success: false,
        reservationData,
        error: purchaseResult.error,
        step: "purchase",
      };
    }

    return {
      success: true,
      reservationData,
      purchaseData: purchaseResult.data,
    };
  }

  /**
   * Enhanced purchase with automatic retry and verification
   *
   * Implements the recommended retry/verification flow:
   * 1. Attempt purchase via proxy
   * 2. On error, check purchase status by idempotency key
   * 3. If not found or failed, verify purchase completion
   * 4. If still not verified, attempt rescue purchase
   *
   * This method provides the most robust purchase flow with automatic
   * recovery from network errors and transient failures.
   *
   * @param params - Purchase parameters including reservation details
   * @returns Purchase result with detailed status
   */
  static async purchaseWithRetryAndVerification(params: {
    userId: string;
    competitionId: string;
    ticketNumbers: number[];
    ticketPrice: number;
    reservationId?: string;
  }): Promise<{
    success: boolean;
    data?: PurchaseResponse;
    error?: string;
    errorDetails?: BalancePaymentError;
    recoveryMethod?: "initial" | "status_check" | "verification" | "rescue";
  }> {
    const { userId, competitionId, ticketNumbers, ticketPrice, reservationId } =
      params;
    const canonicalUserId = toCanonicalUserId(userId);
    const expectedCount = ticketNumbers.length;

    // Generate idempotency key for this purchase attempt
    const idempotencyKeyBase =
      reservationId || `purchase-${competitionId}-${Date.now()}`;
    const idempotencyKey =
      idempotencyKeyManager.getOrCreateKey(idempotencyKeyBase);

    console.log("[BalancePayment] Starting enhanced purchase flow:", {
      userId: canonicalUserId.substring(0, 20) + "...",
      competitionId: competitionId.substring(0, 10) + "...",
      ticketCount: expectedCount,
      reservationId: reservationId || "none",
      idempotencyKey,
    });

    // =====================================================
    // STEP 1: Attempt initial purchase
    // =====================================================
    const initialResult = await this.purchaseWithBalance({
      userId,
      competitionId,
      ticketNumbers,
      ticketPrice,
      reservationId,
    });

    // If initial purchase succeeded, we're done
    if (initialResult.success) {
      console.log("[BalancePayment] Initial purchase succeeded");
      return {
        ...initialResult,
        recoveryMethod: "initial",
      };
    }

    // Check if error is non-retriable (validation, insufficient balance, etc.)
    const errorCode = initialResult.errorDetails?.statusCode || 0;
    if (
      errorCode === 400 ||
      errorCode === 402 ||
      errorCode === 404 ||
      errorCode === 409
    ) {
      console.log(
        "[BalancePayment] Non-retriable error, not attempting recovery",
      );
      return initialResult;
    }

    console.warn(
      "[BalancePayment] Initial purchase failed, starting recovery flow:",
      initialResult.error,
    );

    // =====================================================
    // STEP 2: Check purchase status by idempotency key
    // =====================================================
    try {
      console.log("[BalancePayment] Checking purchase status by key...");
      const { data: statusData, error: statusError } =
        await getPurchaseStatusByKey(supabase, idempotencyKey);

      if (!statusError && statusData?.found) {
        const result = statusData.result;

        // If the stored result shows success, reconstruct the response
        if (result?.success === true) {
          console.log(
            "[BalancePayment] Found successful purchase in idempotency table",
          );

          const transformedData: PurchaseResponse = {
            payment_id: result.entry_id || "recovered-" + idempotencyKey,
            status: "succeeded",
            amount: String(result.total_cost || 0),
            currency: "USD",
            new_balance: String(result.available_balance || 0),
            competition_id: competitionId,
            tickets: (result.ticket_numbers ?? ticketNumbers).map(
              (num: number, index: number) => ({
                id: `${result.entry_id || "recovered"}-${index}`,
                ticket_number: num,
              }),
            ),
          };

          return {
            success: true,
            data: transformedData,
            recoveryMethod: "status_check",
          };
        }

        // If stored result shows error with INTERNAL_ERROR, continue to next step
        if (result?.error_code === "INTERNAL_ERROR") {
          console.log(
            "[BalancePayment] Found INTERNAL_ERROR in status, continuing recovery",
          );
        }
      }
    } catch (statusErr) {
      console.warn(
        "[BalancePayment] Error checking purchase status:",
        statusErr,
      );
    }

    // =====================================================
    // STEP 3: Verify purchase completion
    // =====================================================
    try {
      console.log("[BalancePayment] Verifying purchase completion...");
      const { data: verifyData, error: verifyError } =
        await verifyCompetitionPurchase(supabase, {
          canonicalUserId,
          competitionId,
          expectedCount,
          idempotencyKey,
          reservationId,
        });

      if (!verifyError && verifyData?.success) {
        // Check if we found enough tickets
        if (
          verifyData.meets_expected === true ||
          verifyData.ticket_count >= expectedCount
        ) {
          console.log(
            "[BalancePayment] Purchase verified! Found tickets:",
            verifyData.ticket_count,
          );

          const verifiedTickets = verifyData.ticket_numbers || ticketNumbers;
          const transformedData: PurchaseResponse = {
            payment_id: "verified-" + idempotencyKey,
            status: "succeeded",
            amount: String(ticketPrice * verifiedTickets.length),
            currency: "USD",
            new_balance: String(verifyData.data?.available_balance || 0),
            competition_id: competitionId,
            tickets: verifiedTickets.map((num: number, index: number) => ({
              id: `verified-${index}`,
              ticket_number: num,
            })),
          };

          return {
            success: true,
            data: transformedData,
            recoveryMethod: "verification",
          };
        }

        console.log(
          "[BalancePayment] Verification found partial tickets, attempting rescue",
        );
      }
    } catch (verifyErr) {
      console.warn("[BalancePayment] Error during verification:", verifyErr);
    }

    // =====================================================
    // STEP 4: Rescue purchase attempt
    // =====================================================
    if (reservationId) {
      try {
        console.log("[BalancePayment] Attempting rescue purchase...");
        const { data: rescueData, error: rescueError } =
          await rescuePurchaseAttempt(supabase, {
            userIdentifier: canonicalUserId,
            competitionId,
            ticketPrice,
            expectedCount,
            idempotencyKey,
            reservationId,
          });

        if (!rescueError && rescueData?.success) {
          console.log("[BalancePayment] Rescue purchase succeeded!");

          const transformedData: PurchaseResponse = {
            payment_id: rescueData.entry_id || "rescued-" + idempotencyKey,
            status: "succeeded",
            amount: String(rescueData.total_cost || 0),
            currency: "USD",
            new_balance: String(rescueData.available_balance || 0),
            competition_id: competitionId,
            tickets: (rescueData.ticket_numbers ?? ticketNumbers).map(
              (num: number, index: number) => ({
                id: `${rescueData.entry_id || "rescued"}-${index}`,
                ticket_number: num,
              }),
            ),
          };

          return {
            success: true,
            data: transformedData,
            recoveryMethod: "rescue",
          };
        }

        if (rescueData?.error_code) {
          console.error(
            "[BalancePayment] Rescue failed with error:",
            rescueData.error_code,
          );
          const parsedError = parseError({
            message: rescueData.error || "Rescue attempt failed",
            code: rescueData.error_code,
          });
          return {
            success: false,
            error: getUserFriendlyError(parsedError),
            errorDetails: parsedError,
          };
        }
      } catch (rescueErr) {
        console.error("[BalancePayment] Rescue attempt exception:", rescueErr);
      }
    } else {
      console.log(
        "[BalancePayment] No reservation ID, skipping rescue attempt",
      );
    }

    // =====================================================
    // All recovery attempts failed
    // =====================================================
    console.error("[BalancePayment] All recovery attempts exhausted");
    return {
      success: false,
      error:
        initialResult.error || "Purchase failed after all recovery attempts",
      errorDetails: initialResult.errorDetails,
    };
  }
}

export default BalancePaymentService;
