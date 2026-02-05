/**
 * Base Account Payment Service
 * 
 * Integrates Base Account SDK for one-tap USDC payments on Base network.
 * This service enables users to pay for competition entries using the Base Account SDK
 * which provides a seamless payment experience without requiring wallet connection.
 * 
 * Features:
 * - One-tap USDC payments via Base Account SDK
 * - Payment status tracking
 * - Integration with existing transaction system
 * - Uses centralized SDK instance for consistency
 * 
 * Architecture:
 * - Uses the singleton SDK instance from base-account-sdk.ts
 * - SDK provides EIP-1193 provider for wallet interactions
 * - Supports both direct payments and SDK-managed sessions
 * 
 * Documentation: https://docs.base.org/base-account/guides/accept-payments
 */

import { pay, getPaymentStatus, type PaymentOptions, type PaymentResult, type PaymentStatus } from '@base-org/account/payment/browser';
import { getBaseAccountSDK, getSDKProvider } from './base-account-sdk';
import { supabase } from './supabase';
import { isSuccessStatus, isFailureStatus } from './payment-status';
import { normalizeWalletAddress, toPrizePid } from '../utils/userId';

/**
 * Get the authentication token for API calls
 */
async function getAuthToken(): Promise<string | null> {
  try {
    // For CDP auth, use the wallet address as the auth identifier
    const walletAddress = localStorage.getItem('cdp:wallet_address') ||
                         localStorage.getItem('base:wallet_address');
    if (walletAddress) {
      console.log('Using CDP wallet address as auth token');
      return `wallet:${walletAddress}`;
    }

    // Legacy: Try Privy tokens for backward compatibility
    const privyToken = localStorage.getItem('privy:token') ||
                       localStorage.getItem('privy:access_token');
    if (privyToken) {
      console.log('Using legacy Privy token');
      return privyToken;
    }

    // Fallback to Supabase session token
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      console.log('Using Supabase session token');
      return session.access_token;
    }

    console.warn('No authentication token found');
    return null;
  } catch (err) {
    console.error('Error getting auth token:', err);
    return null;
  }
}

/**
 * Determine if we should use testnet based on environment
 */
function isTestnet(): boolean {
  return import.meta.env.VITE_BASE_MAINNET !== 'true';
}

/**
 * Get the treasury address for payments
 */
function getTreasuryAddress(): string {
  const treasury = import.meta.env.VITE_TREASURY_ADDRESS;
  if (!treasury) {
    throw new Error('Treasury address not configured (VITE_TREASURY_ADDRESS)');
  }
  return treasury;
}

export interface BaseAccountPaymentRequest {
  userId: string;
  competitionId: string;
  ticketCount: number;
  ticketPrice: number;
  selectedTickets: number[];
  walletAddress?: string;
  reservationId?: string | null;
}

export interface BaseAccountPaymentResult {
  success: boolean;
  transactionId: string;
  transactionHash?: string;
  status: string;
  amount: number;
  ticketCount: number;
  error?: string;
  paymentSucceeded?: boolean;
}

/**
 * Secure write endpoint for creating transactions
 */
const isLocalDev = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const SECURE_WRITE_API = isLocalDev 
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/secure-write`
  : '/api/secure-write';

export class BaseAccountPaymentService {
  /**
   * Calculate the total amount for a ticket purchase
   */
  static calculateTotalAmount(ticketCount: number, ticketPrice: number): number {
    return Number((ticketCount * ticketPrice).toFixed(2));
  }

  /**
   * Create a transaction record for a Base Account payment
   */
  static async createTransaction(
    request: BaseAccountPaymentRequest
  ): Promise<{ transactionId: string; totalAmount: number }> {
    const totalAmount = this.calculateTotalAmount(request.ticketCount, request.ticketPrice);

    const authToken = await getAuthToken();
    if (!authToken) {
      console.error('No authentication token available');
      throw new Error('Authentication required to create transaction');
    }

    const response = await fetch(`${SECURE_WRITE_API}/transactions/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        wallet_address: request.walletAddress ? normalizeWalletAddress(request.walletAddress) : null,
        competition_id: request.competitionId,
        ticket_count: request.ticketCount,
        amount: totalAmount,
        reservation_id: request.reservationId || null,
        payment_provider: 'base_account', // Identifies Base Account SDK payments
        network: 'base',
      }),
    });

    let result: { ok?: boolean; error?: string; transactionId?: string; totalAmount?: number };
    try {
      result = await response.json();
    } catch (parseError) {
      console.error('Error parsing transaction creation response:', parseError);
      throw new Error(`Server returned invalid response: HTTP ${response.status}`);
    }

    if (!response.ok || !result.ok) {
      console.error('Error creating transaction:', result.error || result);
      throw new Error(result.error || 'Failed to create transaction record');
    }

    return {
      transactionId: result.transactionId!,
      totalAmount: result.totalAmount || totalAmount,
    };
  }

  /**
   * Update transaction status
   */
  private static async updateTransactionStatus(
    transactionId: string,
    status: string,
    additionalData?: { transactionHash?: string; notes?: string }
  ): Promise<void> {
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        console.warn('[BaseAccountPayment] No auth token, falling back to direct Supabase update');
        await supabase
          .from('user_transactions')
          .update({
            status,
            updated_at: new Date().toISOString(),
            ...(status === 'completed' && { completed_at: new Date().toISOString() }),
            ...(additionalData?.transactionHash && { tx_id: additionalData.transactionHash }),
            ...(additionalData?.notes && { notes: additionalData.notes }),
          })
          .eq('id', transactionId);
        return;
      }

      const response = await fetch(`/api/transaction-status/${transactionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          status,
          ...additionalData,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error('[BaseAccountPayment] Transaction status update failed:', data.error || response.statusText);
      }
    } catch (error) {
      console.error('[BaseAccountPayment] Error updating transaction status:', error);
    }
  }

  /**
   * Process a payment using Base Account SDK
   * 
   * This opens the Base Account payment popup where users can pay with USDC
   * without needing to connect their wallet first.
   */
  static async processPayment(
    transactionId: string,
    amount: number
  ): Promise<BaseAccountPaymentResult> {
    try {
      console.log('[BaseAccountPayment] Starting payment for transaction:', transactionId);
      
      // Update transaction status to processing
      await this.updateTransactionStatus(transactionId, 'processing');

      // Prepare payment options
      const paymentOptions: PaymentOptions = {
        amount: amount.toFixed(2), // Convert to string with 2 decimals
        to: getTreasuryAddress(),
        testnet: isTestnet(),
      };

      console.log('[BaseAccountPayment] Payment options:', {
        amount: paymentOptions.amount,
        to: paymentOptions.to,
        testnet: paymentOptions.testnet,
      });

      // Initiate payment via Base Account SDK
      // This opens a popup for the user to complete the payment
      const paymentResult: PaymentResult = await pay(paymentOptions);

      console.log('[BaseAccountPayment] Payment initiated:', paymentResult);

      if (paymentResult.success) {
        // Update transaction with the payment ID (transaction hash)
        await this.updateTransactionStatus(transactionId, 'completed', {
          transactionHash: paymentResult.id,
        });

        return {
          success: true,
          transactionId,
          transactionHash: paymentResult.id,
          status: 'completed',
          amount,
          ticketCount: 0,
        };
      }

      // Payment failed
      await this.updateTransactionStatus(transactionId, 'failed', {
        notes: 'Base Account payment did not complete successfully',
      });

      return {
        success: false,
        transactionId,
        status: 'failed',
        amount,
        ticketCount: 0,
        error: 'Payment was not completed',
      };
    } catch (error) {
      console.error('[BaseAccountPayment] Payment error:', error);

      // Update transaction as failed
      await this.updateTransactionStatus(transactionId, 'failed', {
        notes: error instanceof Error ? error.message : 'Base Account payment failed',
      });

      // Provide user-friendly error messages
      let errorMessage = 'Payment failed';
      if (error instanceof Error) {
        if (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('User rejected')) {
          errorMessage = 'Payment was cancelled';
        } else if (error.message.includes('insufficient')) {
          errorMessage = 'Insufficient USDC balance';
        } else {
          errorMessage = error.message;
        }
      }

      return {
        success: false,
        transactionId,
        status: 'failed',
        amount,
        ticketCount: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Check the status of a Base Account payment
   * 
   * This polls the Base Account SDK to check if the payment has been completed on-chain
   */
  static async checkPaymentStatus(
    paymentId: string,
    testnet?: boolean
  ): Promise<PaymentStatus> {
    try {
      const status = await getPaymentStatus({
        id: paymentId,
        testnet: testnet ?? isTestnet(),
      });

      return status;
    } catch (error) {
      console.error('[BaseAccountPayment] Error checking payment status:', error);
      return {
        status: 'not_found',
        id: paymentId as `0x${string}`,
        message: 'Could not retrieve payment status',
      };
    }
  }

  /**
   * Complete ticket purchase with Base Account payment
   * 
   * Flow:
   * 1. Create transaction record in database (pending state)
   * 2. Process payment via Base Account SDK
   * 3. Confirm tickets after successful payment
   */
  static async purchaseTickets(request: BaseAccountPaymentRequest): Promise<BaseAccountPaymentResult> {
    let transactionId = '';

    try {
      // Step 1: Create the transaction record
      const { transactionId: txId, totalAmount } = await this.createTransaction(request);
      transactionId = txId;

      console.log('[BaseAccountPayment] Transaction created:', transactionId);

      // Step 2: Process the payment via Base Account
      const paymentResult = await this.processPayment(transactionId, totalAmount);

      if (!paymentResult.success) {
        // Payment failed - don't confirm tickets
        return {
          success: false,
          transactionId,
          status: 'failed',
          amount: totalAmount,
          ticketCount: request.ticketCount,
          error: paymentResult.error || 'Payment failed',
        };
      }

      console.log('[BaseAccountPayment] Payment successful, confirming tickets...');

      // Step 3: Confirm tickets after successful payment
      const confirmBody = {
        reservationId: request.reservationId,
        userId: request.userId,
        competitionId: request.competitionId,
        transactionHash: paymentResult.transactionHash || transactionId,
        paymentProvider: 'base_account',
        walletAddress: request.walletAddress,
        network: 'base',
        selectedTickets: request.selectedTickets,
        ticketCount: request.ticketCount,
        sessionId: transactionId,
      };

      // Call the Netlify proxy for ticket confirmation
      const response = await fetch('/api/confirm-pending-tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(confirmBody),
      });

      let confirmData: any;
      try {
        confirmData = await response.json();
      } catch {
        throw new Error(`Invalid response from confirmation: ${response.status}`);
      }

      if (!response.ok || !confirmData.success) {
        // Ticket confirmation failed, but payment succeeded
        console.error('[BaseAccountPayment] Payment succeeded but ticket confirmation failed:', confirmData.error);

        // Update transaction with warning
        await supabase
          .from('user_transactions')
          .update({
            status: 'completed',
            payment_status: 'completed',
            notes: `Payment completed but ticket confirmation needs review. Error: ${
              confirmData.error || 'Unknown error'
            }`,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', transactionId);

        return {
          success: false,
          transactionId,
          transactionHash: paymentResult.transactionHash,
          status: 'completed',
          amount: totalAmount,
          ticketCount: request.ticketCount,
          error: 'Payment completed! Your tickets are being allocated automatically. Check "My Entries" in a few moments. If tickets don\'t appear within 5 minutes, contact support with your transaction ID.',
          paymentSucceeded: true,
        };
      }

      console.log('[BaseAccountPayment] Purchase complete!');

      return {
        success: true,
        transactionId,
        transactionHash: paymentResult.transactionHash,
        status: 'completed',
        amount: totalAmount,
        ticketCount: request.ticketCount,
      };
    } catch (error) {
      console.error('[BaseAccountPayment] Purchase error:', error);

      // Update transaction as failed if we have a transaction ID
      if (transactionId) {
        await supabase
          .from('user_transactions')
          .update({
            status: 'failed',
            payment_status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', transactionId);
      }

      return {
        success: false,
        transactionId,
        status: 'failed',
        amount: 0,
        ticketCount: request.ticketCount,
        error: error instanceof Error ? error.message : 'Purchase failed',
      };
    }
  }

  /**
   * Get the status of a transaction
   */
  static async getTransactionStatus(transactionId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    transactionHash?: string;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('user_transactions')
        .select('status, tx_id, payment_status')
        .eq('id', transactionId)
        .single();

      if (error) {
        throw error;
      }

      const status = data?.status || data?.payment_status;
      let normalizedStatus: 'pending' | 'processing' | 'completed' | 'failed' = 'pending';

      if (status && isSuccessStatus(status)) {
        normalizedStatus = 'completed';
      } else if (status && isFailureStatus(status)) {
        normalizedStatus = 'failed';
      } else if (status === 'processing' || status === 'confirming') {
        normalizedStatus = 'processing';
      }

      return {
        status: normalizedStatus,
        transactionHash: data?.tx_id ?? undefined,
      };
    } catch (error) {
      console.error('Error getting transaction status:', error);
      return {
        status: 'pending',
        error: 'Failed to get transaction status',
      };
    }
  }

  /**
   * Get user's purchase history for a specific competition
   */
  static async getUserCompetitionPurchases(
    userId: string,
    competitionId: string
  ): Promise<any[]> {
    try {
      const canonicalUserId = toPrizePid(userId);
      const normalizedWallet = normalizeWalletAddress(userId);

      const { data, error } = await supabase
        .from('user_transactions')
        .select('*')
        .eq('competition_id', competitionId)
        .or(`user_id.eq.${canonicalUserId},wallet_address.ilike.${normalizedWallet || userId}`)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching user purchases:', error);
      return [];
    }
  }

  /**
   * Get all of a user's purchase history
   */
  static async getUserPurchaseHistory(userId: string): Promise<any[]> {
    try {
      const canonicalUserId = toPrizePid(userId);
      const normalizedWallet = normalizeWalletAddress(userId);

      const { data, error } = await supabase
        .from('user_transactions')
        .select(`
          *,
          competitions:competition_id (
            id,
            title,
            image_url,
            prize_value
          )
        `)
        .or(`user_id.eq.${canonicalUserId},wallet_address.ilike.${normalizedWallet || userId}`)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching purchase history:', error);
      return [];
    }
  }
}

export default BaseAccountPaymentService;
