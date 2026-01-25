import { supabase } from './supabase';
import { isSuccessStatus, isFailureStatus, POLLING_CONFIG } from './payment-status';

const CREATE_CHARGE_URL = '/api/create-charge';

export const TOP_UP_CHECKOUT_URLS: Record<number, string> = {
  3: 'https://commerce.coinbase.com/checkout/b4a897d7-0a83-49e3-b2ea-8dc27b53e3ea',
  5: 'https://commerce.coinbase.com/checkout/6ffa7b7e-6ea6-42c1-ad76-65ad21d28016',
  10: 'https://commerce.coinbase.com/checkout/2cd60336-22a8-4881-80e2-133fbf840d85',
  25: 'https://commerce.coinbase.com/checkout/bcda0375-739a-4b0c-a5d4-5879c53299a7',
  50: 'https://commerce.coinbase.com/checkout/ba05b195-ce83-49a7-990b-cf76f82e81c1',
  100: 'https://commerce.coinbase.com/checkout/263a89e5-d46b-426b-addf-12699c564034',
  250: 'https://commerce.coinbase.com/checkout/515dafd8-6575-47b5-b66c-dd9a6a2a6e09',
  500: 'https://commerce.coinbase.com/checkout/dbbf62ca-9d9c-400a-8409-17f612de168a',
  1000: 'https://commerce.coinbase.com/checkout/b639b6cc-953c-4024-8bbc-46f667b3ffac',
};

export const ENTRY_CHECKOUT_URLS: Record<number, string> = {
  0.10: 'https://commerce.coinbase.com/checkout/bd66e694-05f3-4c72-88be-f2391bd8b4e4',
  0.25: 'https://commerce.coinbase.com/checkout/c14c557d-429f-4a3c-8b7f-db62860eb9d0',
  0.50: 'https://commerce.coinbase.com/checkout/bf01d189-dc30-46b6-aeb3-1cccb32b4919',
  0.75: 'https://commerce.coinbase.com/checkout/5a8b2956-7d42-45e7-b259-9a8a14c9b067',
  1.00: 'https://commerce.coinbase.com/checkout/468720a6-b54f-4f0e-8266-e8a9a8005be7',
  5.00: 'https://commerce.coinbase.com/checkout/1191b480-2fff-4472-85df-e71afc432866',
  10.00: 'https://commerce.coinbase.com/checkout/bb13d01a-a6c8-45b2-90fd-55996b57517d',
  25.00: 'https://commerce.coinbase.com/checkout/64e7360d-e7b3-4179-890a-4444e3f17320',
};

export interface TopUpResult {
  transactionId: string;
  checkoutUrl: string;
}

export interface EntryPurchaseResult {
  transactionId: string;
  checkoutUrl: string;
  totalAmount: number;
  entryCount: number;
}

interface ChargeResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string | { code: string; message: string };
  debug?: Record<string, unknown>;
}

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

async function callCreateCharge(body: Record<string, unknown>): Promise<ChargeResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

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
    console.error('[CoinbaseCommerce] Charge creation failed:', {
      status: response.status,
      error: responseData.error,
      debug: responseData.debug
    });
    throw new Error(errorMessage);
  }

  // Normalize the response to handle different response formats
  // Some deployments return data wrapped in a 'data' object, others return flat structure
  // Some use camelCase (chargeId), others use snake_case (charge_id)
  const rawData = responseData.data || responseData;
  const normalizedData: Record<string, unknown> = {};

  console.log('[CoinbaseCommerce] callCreateCharge raw response:', JSON.stringify(responseData));
  console.log('[CoinbaseCommerce] callCreateCharge rawData for normalization:', JSON.stringify(rawData));

  // Handle chargeId/charge_id - check both the rawData and the top-level responseData
  // in case the response has a flat structure without nesting
  normalizedData.chargeId = (rawData as any).chargeId ||
                            (rawData as any).charge_id ||
                            (responseData as any).chargeId ||
                            (responseData as any).charge_id;
  // Handle transactionId/transaction_id
  normalizedData.transactionId = (rawData as any).transactionId ||
                                  (rawData as any).transaction_id ||
                                  (responseData as any).transactionId ||
                                  (responseData as any).transaction_id;
  // Handle chargeCode/charge_code
  normalizedData.chargeCode = (rawData as any).chargeCode ||
                              (rawData as any).charge_code ||
                              (responseData as any).chargeCode ||
                              (responseData as any).charge_code;
  // Handle checkoutUrl/checkout_url
  normalizedData.checkoutUrl = (rawData as any).checkoutUrl ||
                                (rawData as any).checkout_url ||
                                (responseData as any).checkoutUrl ||
                                (responseData as any).checkout_url;

  console.log('[CoinbaseCommerce] callCreateCharge normalized data:', JSON.stringify(normalizedData));

  return {
    ...responseData,
    data: normalizedData,
  };
}

export class CoinbaseCommerceService {
  /**
   * Create a top-up transaction via Coinbase Commerce.
   * Creates a dynamic charge (NOT pre-configured URL) to ensure metadata is passed for webhooks.
   * Uses optimistic crediting to immediately show pending balance to user.
   */
  static async createTopUpTransaction(
    userId: string,
    amount: number,
  ): Promise<TopUpResult> {
    // Validate required fields before making the request
    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    // Validate amount
    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error(`Invalid amount: ${amount}`);
    }

    // CRITICAL: Do NOT use pre-configured checkout URLs - they don't pass metadata
    // Always create dynamic charges so webhook receives user_id for crediting
    const result = await callCreateCharge({
      userId,
      totalAmount: normalizedAmount,
      type: 'topup',
      // No checkoutUrl - force dynamic charge creation with metadata
    });

    const transactionId = (result.data?.transactionId as string) || '';
    const chargeId = (result.data?.chargeId as string) || '';
    const chargeCode = (result.data?.chargeCode as string) || '';
    let checkoutUrl = (result.data?.checkoutUrl as string) || '';

    // FALLBACK: If checkoutUrl is missing but we have chargeCode, construct it
    // Coinbase Commerce checkout URL format: https://commerce.coinbase.com/charges/{chargeCode}
    if (!checkoutUrl && chargeCode) {
      checkoutUrl = `https://commerce.coinbase.com/charges/${chargeCode}`;
      console.log('[CoinbaseCommerce] TopUp: Constructed checkout URL from chargeCode:', checkoutUrl);
    }

    // FALLBACK 2: If still no URL but we have chargeId, try that format
    if (!checkoutUrl && chargeId) {
      checkoutUrl = `https://commerce.coinbase.com/charges/${chargeId}`;
      console.log('[CoinbaseCommerce] TopUp: Constructed checkout URL from chargeId:', checkoutUrl);
    }

    // Log warning if we still don't have a checkout URL
    if (!checkoutUrl) {
      console.error('[CoinbaseCommerce] TopUp: No checkout URL available after all fallbacks:', {
        transactionId,
        chargeId,
        chargeCode,
        rawData: result.data,
      });
    }

    // OPTIMISTIC CREDITING: Create a pending top-up record so user sees balance immediately
    // Webhook will finalize the credit; if payment fails, cleanup job removes pending balance
    if (transactionId && normalizedAmount > 0) {
      try {
        await this.optimisticallyCreditTopUp({
          transactionId,
          userId,
          amount: normalizedAmount,
        });
      } catch (error) {
        // Don't fail the purchase if optimistic crediting fails
        // The backend webhook will still credit them properly
        console.warn('[CoinbaseCommerce] Optimistic top-up crediting failed (non-critical):', error);
      }
    }

    return {
      transactionId,
      checkoutUrl,
    };
  }

  /**
   * Optimistically credit top-up to user's pending balance before payment confirmation.
   * Creates a pending_topups record that shows in dashboard, confirmed by webhook later.
   * The pending balance is added to sub_account_balances.pending_balance until confirmed.
   */
  private static async optimisticallyCreditTopUp(params: {
    transactionId: string;
    userId: string;
    amount: number;
  }): Promise<void> {
    const { transactionId, userId, amount } = params;

    // Convert userId to canonical format (prize:pid:xxx)
    const canonicalUserId = userId.startsWith('prize:pid:') ? userId :
      userId.startsWith('0x') ? `prize:pid:${userId.toLowerCase()}` :
      `prize:pid:${userId}`;

    // Insert into pending_topups table - webhook will confirm and move to available_balance
    const { error } = await (supabase as any)
      .from('pending_topups')
      .insert({
        user_id: userId,
        canonical_user_id: canonicalUserId,
        amount: amount,
        status: 'pending',
        session_id: transactionId,
        payment_provider: 'coinbase_commerce',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min expiry
        created_at: new Date().toISOString(),
      } as any);

    if (error) {
      // If table doesn't exist yet, that's OK - webhook will still credit
      if (error.code !== '42P01') { // relation does not exist
        console.error('[CoinbaseCommerce] Failed to insert pending top-up:', error);
        throw error;
      }
      console.warn('[CoinbaseCommerce] pending_topups table does not exist, skipping optimistic credit');
      return;
    }

    // Also add to pending_balance in sub_account_balances for immediate visibility
    const { error: balanceError } = await supabase.rpc('add_pending_balance', {
      user_identifier: canonicalUserId,
      amount: amount
    });

    if (balanceError) {
      // RPC might not exist yet - that's OK, webhook will handle it
      console.warn('[CoinbaseCommerce] add_pending_balance RPC not available:', balanceError.message);
    }

    console.log(`[CoinbaseCommerce] Created pending top-up for $${amount}, txId=${transactionId}`);
  }

  /**
   * Create an entry purchase transaction via Coinbase Commerce.
   * Creates a dynamic charge with user metadata for proper webhook crediting.
   */
  static async createEntryPurchase(
    userId: string,
    competitionId: string,
    entryPrice: number,
    entryCount: number,
    selectedTickets: number[],
    reservationId?: string | null,
  ): Promise<EntryPurchaseResult> {
    // Validate required fields before making the request
    if (!userId) {
      throw new Error('Missing required field: userId');
    }
    if (!competitionId) {
      throw new Error('Missing required field: competitionId');
    }

    // Validate and normalize numeric inputs
    const normalizedEntryPrice = Math.round(Number(entryPrice) * 100) / 100;
    const normalizedEntryCount = Number(entryCount);

    if (!Number.isFinite(normalizedEntryPrice) || normalizedEntryPrice <= 0) {
      throw new Error(`Invalid entryPrice: ${entryPrice}`);
    }
    if (!Number.isFinite(normalizedEntryCount) || normalizedEntryCount <= 0) {
      throw new Error(`Invalid entryCount: ${entryCount}`);
    }

    const totalAmount = normalizedEntryPrice * normalizedEntryCount;

    // CRITICAL: Do NOT pass checkoutUrl - creates dynamic charge with metadata
    const result = await callCreateCharge({
      userId,
      competitionId,
      entryPrice: normalizedEntryPrice,
      entryCount: normalizedEntryCount,
      totalAmount,
      selectedTickets,
      reservationId,
      type: 'entry',
    });

    const transactionId = (result.data?.transactionId as string) || '';
    const chargeId = (result.data?.chargeId as string) || '';
    const chargeCode = (result.data?.chargeCode as string) || '';
    let checkoutUrl = (result.data?.checkoutUrl as string) || '';

    // FALLBACK: If checkoutUrl is missing but we have chargeCode, construct it
    // Coinbase Commerce checkout URL format: https://commerce.coinbase.com/charges/{chargeCode}
    if (!checkoutUrl && chargeCode) {
      checkoutUrl = `https://commerce.coinbase.com/charges/${chargeCode}`;
      console.log('[CoinbaseCommerce] Constructed checkout URL from chargeCode:', checkoutUrl);
    }

    // FALLBACK 2: If still no URL but we have chargeId, try that format
    if (!checkoutUrl && chargeId) {
      // Some versions use the charge ID directly
      checkoutUrl = `https://commerce.coinbase.com/charges/${chargeId}`;
      console.log('[CoinbaseCommerce] Constructed checkout URL from chargeId:', checkoutUrl);
    }

    // Log warning if we still don't have a checkout URL
    if (!checkoutUrl) {
      console.error('[CoinbaseCommerce] No checkout URL available after all fallbacks:', {
        transactionId,
        chargeId,
        chargeCode,
        rawData: result.data,
      });
    }

    // HACKY BUT EFFECTIVE: Optimistically credit entries to user's dashboard immediately
    // This ensures users see their entries even if payment metadata is lost
    // Backend webhook will reconcile and confirm payment later
    if (transactionId && selectedTickets.length > 0) {
      try {
        await this.optimisticallyCreditEntries({
          transactionId,
          userId,
          competitionId,
          selectedTickets,
          entryPrice: normalizedEntryPrice,
          entryCount: normalizedEntryCount,
          totalAmount,
        });
      } catch (error) {
        // Don't fail the purchase if optimistic crediting fails
        // The backend webhook will still credit them properly
        console.warn('[CoinbaseCommerce] Optimistic crediting failed (non-critical):', error);
      }
    }

    return {
      transactionId,
      checkoutUrl,
      totalAmount,
      entryCount: normalizedEntryCount,
    };
  }

  /**
   * Optimistically credit entries to user's dashboard before payment confirmation.
   * Creates pending_tickets record that shows in dashboard, confirmed by webhook later.
   */
  private static async optimisticallyCreditEntries(params: {
    transactionId: string;
    userId: string;
    competitionId: string;
    selectedTickets: number[];
    entryPrice: number;
    entryCount: number;
    totalAmount: number;
  }): Promise<void> {
    const { transactionId, userId, competitionId, selectedTickets, entryPrice, entryCount, totalAmount } = params;

    // Convert userId to canonical format (prize:pid:xxx)
    const canonicalUserId = userId.startsWith('prize:pid:') ? userId : 
      userId.startsWith('0x') ? `prize:pid:${userId.toLowerCase()}` : 
      `prize:pid:${userId}`;

    // Insert into pending_tickets - webhook will confirm and create actual tickets
    const { error } = await supabase
      .from('pending_tickets')
      .insert({
        user_id: userId,
        canonical_user_id: canonicalUserId,
        competition_id: competitionId,
        ticket_numbers: selectedTickets,
        ticket_count: entryCount,
        ticket_price: entryPrice,
        total_amount: totalAmount,
        status: 'pending',
        session_id: transactionId,
        payment_provider: 'coinbase_commerce',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min expiry
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[CoinbaseCommerce] Failed to insert pending tickets:', error);
      throw error;
    }

    console.log(`[CoinbaseCommerce] Created pending_tickets for ${selectedTickets.length} tickets, txId=${transactionId}`);
  }

  /**
   * Get the checkout URL for a specific entry price.
   * Returns the matching pre-configured checkout URL.
   */
  static getEntryCheckoutUrl(entryPrice: number): string | null {
    // Normalize the price (handle floating point issues)
    const normalizedPrice = Math.round(entryPrice * 100) / 100;
    return ENTRY_CHECKOUT_URLS[normalizedPrice] || null;
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
        return null;
      }

      return data?.status || data?.payment_status || null;
    } catch {
      return null;
    }
  }

  /**
   * Poll for transaction completion.
   * Returns a promise that resolves when the transaction reaches a terminal state.
   *
   * Success statuses: completed, finished, confirmed, success, paid
   * Failure statuses: failed, expired, cancelled, unresolved, error
   */
  static async waitForTransactionCompletion(
    transactionId: string,
    maxAttempts: number = POLLING_CONFIG.maxAttempts,
    intervalMs: number = POLLING_CONFIG.intervalMs
  ): Promise<{ success: boolean; status: string }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getTransactionStatus(transactionId);

      if (status && isSuccessStatus(status)) {
        return { success: true, status };
      }

      if (status && isFailureStatus(status)) {
        return { success: false, status };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return { success: false, status: 'timeout' };
  }

  /**
   * Get available top-up amounts
   */
  static getAvailableTopUpAmounts(): number[] {
    return Object.keys(TOP_UP_CHECKOUT_URLS).map(Number).sort((a, b) => a - b);
  }

  /**
   * Get available entry prices
   */
  static getAvailableEntryPrices(): number[] {
    return Object.keys(ENTRY_CHECKOUT_URLS).map(Number).sort((a, b) => a - b);
  }
}

// Export config (no secrets exposed)
export const COINBASE_CONFIG = {
  CREATE_CHARGE_ENDPOINT: '/api/create-charge',
  WEBHOOK_ENDPOINT: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook',
};
