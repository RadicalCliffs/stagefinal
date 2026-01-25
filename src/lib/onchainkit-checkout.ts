import { supabase } from './supabase';

/**
 * OnchainKit Checkout Service - Client-side wrapper
 *
 * Handles cryptocurrency payments via OnchainKit's embedded Checkout component.
 * This provides an in-app modal experience (no redirect) for EVM chains.
 *
 * Supported networks: Base, Ethereum, Polygon
 * Supported tokens: USDC, ETH, and other ERC20 tokens
 *
 * This module provides:
 * - Charge creation for OnchainKit Checkout
 * - Transaction tracking integration
 * - Webhook compatibility with existing Coinbase Commerce webhooks
 */

// Use the local Netlify function proxy for CORS-free requests
const CREATE_CHARGE_URL = '/api/create-charge';

export interface OnchainKitChargeResult {
  transactionId: string;
  chargeId: string;
  chargeCode: string;
  totalAmount: number;
  entryCount: number;
}

interface ChargeResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string | { code: string; message: string };
  debug?: Record<string, unknown>;
}

/**
 * Extract error message from various error response formats
 */
function extractErrorMessage(response: ChargeResponse): string {
  if (!response.error) {
    return 'Unknown error';
  }
  if (typeof response.error === 'string') {
    return response.error;
  }
  if (typeof response.error === 'object' && response.error.message) {
    return response.error.message;
  }
  return 'Unknown error';
}

/**
 * Helper to call the external create-charge function
 */
async function callCreateCharge(body: Record<string, unknown>): Promise<ChargeResponse> {
  // Build headers with optional Authorization from Supabase session
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Attach Supabase access token for authentication if available
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(CREATE_CHARGE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  // Read the response body as text first (can only read once)
  const responseText = await response.text();

  // Parse the response as JSON
  let responseData: ChargeResponse;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    throw new Error(`Failed to create charge: Invalid response - ${responseText.substring(0, 200)}`);
  }

  // Handle error responses consistently
  if (!response.ok || responseData.success === false) {
    const errorMessage = extractErrorMessage(responseData);
    console.error('[OnchainKit] Charge creation failed:', {
      status: response.status,
      error: responseData.error,
      details: (responseData as any).details,
      debug: responseData.debug
    });
    throw new Error(errorMessage);
  }

  return responseData as any;
}

export class OnchainKitCheckoutService {
  /**
   * Create an entry purchase charge for OnchainKit Checkout.
   * Returns chargeId which is used by the Checkout component's chargeHandler.
   *
   * The OnchainKit Checkout component uses a chargeHandler that returns a chargeId.
   * This service creates the charge via our backend and returns the chargeId.
   */
  static async createEntryCharge(
    userId: string,
    competitionId: string,
    entryPrice: number,
    entryCount: number,
    selectedTickets: number[],
    reservationId?: string | null,
  ): Promise<OnchainKitChargeResult> {
    // Validate required fields before making the request
    if (!userId) {
      throw new Error('Missing required field: userId');
    }
    if (!competitionId) {
      throw new Error('Missing required field: competitionId');
    }

    // Validate and normalize inputs before computing totalAmount
    const normalizedEntryPrice = Number(entryPrice);
    const normalizedEntryCount = Number(entryCount);

    // Log input values for debugging
    console.log('[OnchainKit] createEntryCharge inputs:', {
      entryPrice,
      entryPriceType: typeof entryPrice,
      normalizedEntryPrice,
      entryCount,
      entryCountType: typeof entryCount,
      normalizedEntryCount,
    });

    // Validate inputs before calculation
    if (!Number.isFinite(normalizedEntryPrice) || normalizedEntryPrice <= 0) {
      throw new Error(`Invalid entryPrice: ${entryPrice} (type: ${typeof entryPrice})`);
    }
    if (!Number.isFinite(normalizedEntryCount) || normalizedEntryCount <= 0) {
      throw new Error(`Invalid entryCount: ${entryCount} (type: ${typeof entryCount})`);
    }

    const totalAmount = normalizedEntryPrice * normalizedEntryCount;

    console.log('[OnchainKit] Computed totalAmount:', totalAmount);

    try {
      // Call external server function to create the charge
      // This uses the same endpoint as Coinbase Commerce but returns the chargeId
      const requestBody = {
        userId,
        competitionId,
        entryPrice: normalizedEntryPrice,
        entryCount: normalizedEntryCount,
        totalAmount,
        selectedTickets,
        reservationId,
        type: 'entry',
        paymentMethod: 'onchainkit', // Flag to indicate this is for OnchainKit
      };

      console.log('[OnchainKit] Request body:', JSON.stringify(requestBody));

      const result = await callCreateCharge(requestBody);

      console.log('[OnchainKit] Response:', JSON.stringify(result));

      // Validate that we got a chargeId
      const chargeId = (result.data?.chargeId as string);
      if (!chargeId || chargeId.trim() === '') {
        console.error('[OnchainKit] No chargeId in response:', result);
        throw new Error('Failed to create charge: No chargeId received from payment service. Please try again or contact support.');
      }

      // callCreateCharge throws on error, so if we get here, it was successful
      return {
        transactionId: (result.data?.transactionId as string) || '',
        chargeId,
        chargeCode: (result.data?.chargeCode as string) || '',
        totalAmount,
        entryCount,
      };
    } catch (error) {
      console.error('Error creating OnchainKit entry charge:', error);
      throw error;
    }
  }

  /**
   * Get transaction status from the database.
   * Status updates come via webhook, so we poll the DB.
   */
  static async getTransactionStatus(transactionId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('user_transactions')
        .select('status, payment_status')
        .eq('id', transactionId)
        .single();

      if (error) {
        console.error('Error fetching transaction status:', error);
        return null;
      }

      return data?.status || data?.payment_status || null;
    } catch (error) {
      console.error('Error getting transaction status:', error);
      return null;
    }
  }

  /**
   * Update transaction with OnchainKit payment details.
   * Called when payment completes in the OnchainKit modal.
   */
  static async updateTransactionOnComplete(
    transactionId: string,
    txHash: string,
    status: 'success' | 'pending' | 'error'
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('user_transactions')
        .update({
          tx_hash: txHash,
          status: status === 'success' ? 'finished' : status,
          payment_status: status === 'success' ? 'confirmed' : status,
        })
        .eq('id', transactionId);

      if (error) {
        console.error('Error updating transaction:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating transaction on complete:', error);
      return false;
    }
  }

  /**
   * Link pending reservation to transaction.
   * Call this after creating the charge to ensure webhook can find the held entries.
   */
  static async linkReservation(reservationId: string, transactionId: string): Promise<void> {
    try {
      // Use RPC function to bypass RLS which fails with Privy auth (auth.uid() is null)
      const { error: rpcError } = await supabase.rpc(
        'link_pending_reservation_to_session',
        { p_reservation_id: reservationId, p_session_id: transactionId }
      );

      if (rpcError) {
        // Fallback to direct update if RPC doesn't exist yet
        console.warn('[linkReservation] RPC not available, using fallback:', rpcError.message);

        await (supabase as any)
          .from('pending_tickets')
          .update({ session_id: transactionId } as any)
          .eq('id', reservationId);
      }
    } catch (error) {
      console.error('Error linking reservation:', error);
    }
  }
}

// Export config
export const ONCHAINKIT_CONFIG = {
  CREATE_CHARGE_ENDPOINT: '/api/create-charge',
  // OnchainKit Checkout uses the same commerce webhook for payment confirmation
  // Use environment variable for flexibility between environments
  WEBHOOK_ENDPOINT: import.meta.env.VITE_COMMERCE_WEBHOOK_URL || 'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook',
  SUPPORTED_CHAINS: ['base', 'ethereum', 'polygon'],
};
