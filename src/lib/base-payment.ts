import { supabase } from './supabase';
import { isSuccessStatus, isFailureStatus, isProcessingStatus } from './payment-status';
import { withRetry, isNetworkError } from './error-handler';
import { normalizeWalletAddress, toPrizePid } from '../utils/userId';

/**
 * Base Payment Service - Client-side wrapper
 *
 * ARCHITECTURE NOTE - CDP Embedded Wallets:
 * =========================================
 * This application uses CDP EMBEDDED WALLETS for user funds:
 * - Users authenticate via CDP React (@coinbase/cdp-react) which creates embedded wallets
 * - User USDC is stored in their embedded wallet, controlled by their email/passkey
 * - The treasury address (VITE_TREASURY_ADDRESS) is the RECIPIENT of payments, not a custodian
 *
 * Payment Methods:
 * 1. Direct Wallet Transfer - User signs tx to transfer USDC to treasury (this service)
 * 2. Spend Permissions - One-click payments using pre-authorized spending limits
 * 3. OnchainKit Checkout - External payment flow for wallet connection
 *
 * DO NOT use the /api/cdp/transfer/* endpoints for user payments!
 * Those server wallet functions are deprecated for payment flows.
 *
 * Handles USDC payments on Base network via user's CDP embedded wallet.
 * This service enables users to:
 * - Pay for competition entries using USDC on Base
 * - Calculate total amounts for ticket purchases
 * - Track payment status via the user_transactions table
 */

// CDP API endpoint (Netlify function) - DEPRECATED: Not used for user payments
// User funds are in embedded wallets, not server wallets. Kept for reference only.
const CDP_API_BASE = '/api/cdp';

// Secure write endpoint for creating transactions server-side
// Use Netlify function in production, Supabase Edge Function for local dev
const isLocalDev = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const SECURE_WRITE_API = isLocalDev 
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/secure-write`
  : '/api/secure-write';

/**
 * Get the authentication token for API calls
 *
 * For CDP/Base authentication, we use the wallet address directly.
 * The backend validates this against the user's session state.
 *
 * Token sources (in order of preference):
 * 1. Wallet address from CDP auth (stored after sign-in)
 * 2. Legacy Privy tokens (for backward compatibility during migration)
 * 3. Supabase session token (fallback)
 */
async function getAuthToken(): Promise<string | null> {
  try {
    // For CDP auth, use the wallet address as the auth identifier
    // This is set by AuthContext when CDP sign-in completes
    const walletAddress = localStorage.getItem('cdp:wallet_address') ||
                         localStorage.getItem('base:wallet_address');
    if (walletAddress) {
      // Create a bearer token with wallet address prefix
      // Backend validates this against the user's session
      console.log('Using CDP wallet address as auth token');
      return `wallet:${walletAddress}`;
    }

    // Legacy: Try Privy tokens for backward compatibility during migration
    const privyToken = localStorage.getItem('privy:token') ||
                       localStorage.getItem('privy:access_token');
    if (privyToken) {
      console.log('Using legacy Privy token');
      return privyToken;
    }

    // Try to parse Privy's auth state from localStorage
    const privyAuthState = localStorage.getItem('privy:authState');
    if (privyAuthState) {
      try {
        const parsed = JSON.parse(privyAuthState);
        if (parsed.accessToken) {
          console.log('Using legacy Privy token from authState');
          return parsed.accessToken;
        }
      } catch {
        // Continue to fallback
      }
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

export interface BasePaymentRequest {
  userId: string;
  competitionId: string;
  ticketCount: number;
  ticketPrice: number;
  selectedTickets: number[];
  walletAddress: string;
  reservationId?: string | null;
  // Privy wallet integration - pass the wallet provider for client-side signing
  walletProvider?: any;
  // User's email for unique CDP account identification
  userEmail?: string;
}

export interface BasePaymentResult {
  success: boolean;
  transactionId: string;
  transactionHash?: string;
  status: string;
  amount: number;
  ticketCount: number;
  error?: string;
  /** Flag indicating payment succeeded but ticket allocation failed - user should contact support */
  paymentSucceeded?: boolean;
}

export interface TransactionStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  transactionHash?: string;
  error?: string;
}

export class BasePaymentService {
  /**
   * Calculate the total amount for a ticket purchase
   */
  static calculateTotalAmount(ticketCount: number, ticketPrice: number): number {
    return Number((ticketCount * ticketPrice).toFixed(2));
  }

  /**
   * Create a transaction record for a Base payment
   * This is called before initiating the actual payment
   * Uses the secure-write Netlify function to bypass RLS restrictions
   */
  static async createTransaction(
    request: BasePaymentRequest
  ): Promise<{ transactionId: string; totalAmount: number }> {
    const totalAmount = this.calculateTotalAmount(request.ticketCount, request.ticketPrice);

    // Get authentication token for the API call
    const authToken = await getAuthToken();

    if (!authToken) {
      console.error('No authentication token available');
      throw new Error('Authentication required to create transaction');
    }

    // Create transaction via secure-write endpoint (server-side, bypasses RLS)
    // Explicitly set payment_provider and network for Base wallet payments via Privy
    // NOTE: 'type' field is NOT sent - the server infers type from competition_id:
    //   - competition_id IS NOT NULL → entry purchase
    //   - competition_id IS NULL → wallet top-up
    // NOTE: Wallet address is normalized to lowercase for case-insensitive matching
    const response = await fetch(`${SECURE_WRITE_API}/transactions/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        wallet_address: normalizeWalletAddress(request.walletAddress) || request.walletAddress,
        competition_id: request.competitionId,
        ticket_count: request.ticketCount,
        amount: totalAmount,
        reservation_id: request.reservationId || null,
        payment_provider: 'privy_base_wallet', // Explicit: Privy-signed Base wallet payment
        network: 'base', // Explicit: Base network
      }),
    });

    // Safely parse the response JSON with error handling
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
      transactionId: result.transactionId,
      totalAmount: result.totalAmount || totalAmount,
    };
  }

  /**
   * Helper method to update transaction status via Netlify function
   * This bypasses RLS restrictions that can cause auth.uid() null issues
   */
  private static async updateTransactionStatus(
    transactionId: string,
    status: string,
    additionalData?: { transactionHash?: string; notes?: string }
  ): Promise<void> {
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        // Fallback to direct Supabase update if no auth token
        console.warn('[BasePayment] No auth token, falling back to direct Supabase update');
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
        console.error('[BasePayment] Transaction status update failed:', data.error || response.statusText);
        // Don't throw - we want the payment flow to continue even if status update fails
      }
    } catch (error) {
      console.error('[BasePayment] Error updating transaction status:', error);
      // Don't throw - we want the payment flow to continue
    }
  }

  /**
   * Process a Base USDC payment via the user's Privy wallet
   *
   * @param transactionId - The transaction ID from createTransaction
   * @param senderAddress - The user's wallet address
   * @param amount - The amount in USDC to transfer
   * @param walletProvider - The Privy wallet provider for signing (optional)
   * @param userEmail - The user's email for CDP account identification (optional)
   */
  static async processPayment(
    transactionId: string,
    senderAddress: string,
    amount: number,
    walletProvider?: any,
    _userEmail?: string
  ): Promise<BasePaymentResult> {
    try {
      // Update transaction status to processing via Netlify function
      await this.updateTransactionStatus(transactionId, 'processing');

      // If we have a Privy wallet provider, use it for direct wallet transfer
      if (walletProvider) {
        return await this.processPrivyWalletPayment(
          transactionId,
          senderAddress,
          amount,
          walletProvider
        );
      }

      // No wallet provider available - cannot process payment
      // The CDP smart account fallback has been removed because:
      // 1. CDP smart accounts are server-managed wallets that don't have user funds
      // 2. User's USDC is in their Base wallet, not in a CDP smart account
      // 3. To transfer from user's wallet, we need a wallet provider for signing
      //
      // Users should use one of these payment methods instead:
      // - OnchainKit Checkout (connects their wallet directly)
      // - "Pay with connected wallet" option (requires wallet provider)
      // - Balance payment (uses their site balance)
      console.error('[BasePayment] No wallet provider available for payment');
      console.error('[BasePayment] CDP smart account fallback is not supported - user funds are in their Base wallet, not in server-managed accounts');

      // Update transaction as failed via Netlify function
      await this.updateTransactionStatus(transactionId, 'failed', {
        notes: 'Wallet provider not available - please use OnchainKit checkout or connect wallet directly',
      });

      return {
        success: false,
        transactionId,
        status: 'failed',
        amount,
        ticketCount: 0,
        error: 'Wallet not connected for payment. Please use "Pay with any wallet" option or try again after reconnecting your wallet.',
      };
    } catch (error) {
      console.error('Base payment error:', error);

      // Update transaction as failed via Netlify function
      await this.updateTransactionStatus(transactionId, 'failed');

      return {
        success: false,
        transactionId,
        status: 'failed',
        amount,
        ticketCount: 0,
        error: error instanceof Error ? error.message : 'Payment failed',
      };
    }
  }

  /**
   * Process payment directly through the user's Privy wallet
   * This sends USDC directly from the user's wallet to the treasury
   */
  static async processPrivyWalletPayment(
    transactionId: string,
    senderAddress: string,
    amount: number,
    walletProvider: any
  ): Promise<BasePaymentResult> {
    try {
      const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS;
      if (!treasuryAddress) {
        throw new Error('Treasury address not configured');
      }

      // USDC contract addresses - use mainnet or testnet based on environment
      const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
      const USDC_MAINNET = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'; // USDC on Base Mainnet
      const USDC_TESTNET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // USDC on Base Sepolia
      const USDC_ADDRESS = import.meta.env.VITE_USDC_CONTRACT_ADDRESS || (isMainnet ? USDC_MAINNET : USDC_TESTNET);

      // Convert amount to USDC units (6 decimals)
      const amountInUnits = BigInt(Math.floor(amount * 1_000_000));

      // ERC20 transfer function signature: transfer(address,uint256)
      // Function selector: 0xa9059cbb
      const transferFunctionSelector = '0xa9059cbb';

      // Encode the parameters (address and amount)
      const paddedAddress = treasuryAddress.slice(2).padStart(64, '0');
      const paddedAmount = amountInUnits.toString(16).padStart(64, '0');

      const data = `${transferFunctionSelector}${paddedAddress}${paddedAmount}`;

      // Send the transaction through the Privy wallet provider
      const txHash = await walletProvider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: senderAddress,
          to: USDC_ADDRESS,
          data: data,
          // Gas will be estimated automatically
        }],
      });

      // Update transaction with the blockchain transaction hash via Netlify function
      await this.updateTransactionStatus(transactionId, 'completed', {
        transactionHash: txHash,
      });

      return {
        success: true,
        transactionId,
        transactionHash: txHash,
        status: 'completed',
        amount,
        ticketCount: 0,
      };
    } catch (error) {
      console.error('Privy wallet payment error:', error);

      // Update transaction as failed via Netlify function
      await this.updateTransactionStatus(transactionId, 'failed');

      // Provide user-friendly error messages
      let errorMessage = 'Payment failed';
      if (error instanceof Error) {
        if (error.message.includes('rejected') || error.message.includes('denied')) {
          errorMessage = 'Transaction was rejected by wallet';
        } else if (error.message.includes('insufficient')) {
          errorMessage = 'Insufficient USDC balance in your wallet';
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
   * Create and process a complete ticket purchase with Base USDC
   *
   * Flow:
   * 1. Create transaction record in database (pending state)
   * 2. Process blockchain transfer via Privy wallet (or fallback to CDP)
   * 3. Confirm tickets after successful payment
   */
  static async purchaseTickets(request: BasePaymentRequest): Promise<BasePaymentResult> {
    let transactionId = '';

    try {
      // Step 1: Create the transaction record
      const { transactionId: txId, totalAmount } = await this.createTransaction(request);
      transactionId = txId;

      // Step 2: Process the actual blockchain payment
      // Pass the wallet provider if available for direct Privy wallet transfers
      // Pass userEmail for CDP account identification
      const paymentResult = await this.processPayment(
        transactionId,
        request.walletAddress,
        totalAmount,
        request.walletProvider,
        request.userEmail
      );

      if (!paymentResult.success) {
        // Payment failed - don't confirm tickets
        return {
          success: false,
          transactionId,
          status: 'failed',
          amount: totalAmount,
          ticketCount: 0,
          error: paymentResult.error || 'Blockchain transfer failed',
        };
      }

      // Step 3: Confirm tickets after successful blockchain transfer
      // This function handles both reserved tickets (from pending_tickets) and direct selections
      // Use retry logic since payment has succeeded and tickets MUST be confirmed
      const confirmBody = {
        reservationId: request.reservationId,
        userId: request.userId,
        competitionId: request.competitionId,
        transactionHash: paymentResult.transactionHash || transactionId,
        paymentProvider: 'privy_base_wallet', // Explicit: Privy-signed Base wallet payment
        walletAddress: request.walletAddress, // Pass wallet address for tracking
        network: 'base', // Explicit: Base network
        selectedTickets: request.selectedTickets,
        ticketCount: request.ticketCount, // Pass ticket count for lucky dip allocation
        sessionId: transactionId, // Pass transaction ID for fallback ticket count lookup
      };

      let confirmResult: { data: any; error: any } = { data: null, error: null };
      let confirmationSucceeded = false;

      // Use Netlify proxy for ticket confirmation - more reliable than direct Supabase Edge Function calls
      // The proxy handles retry logic server-side with better network reliability
      // This is critical because payment has already succeeded
      try {
        confirmResult = await withRetry(
          async () => {
            // Call the Netlify proxy instead of Supabase Edge Function directly
            // Server-to-server calls are more reliable than browser-to-server
            const response = await fetch('/api/confirm-pending-tickets', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(confirmBody),
            });

            let data: any;
            try {
              data = await response.json();
            } catch {
              throw new Error(`Invalid response from confirmation proxy: ${response.status}`);
            }

            // Check for HTTP errors - 503 is retryable (Supabase cold start)
            if (!response.ok) {
              const errorMessage = data?.error || `HTTP ${response.status}`;
              // Check if this was a network error that exhausted retries on the server
              // or a 503 which indicates Supabase cold start issues
              if (data?.retriesExhausted || response.status === 503 || isNetworkError({ message: errorMessage })) {
                console.warn('Ticket confirmation network error via proxy, will retry:', errorMessage);
                throw new Error(`Network error during ticket confirmation: ${errorMessage}`);
              }
              // Non-network error from the function itself
              return { data, error: new Error(errorMessage) };
            }

            // If the function returned but with success: false, check if retryable
            if (data && data.success === false) {
              // Some errors are not worth retrying (e.g., invalid input)
              const errorMsg = data.error || '';
              if (errorMsg.includes('expired') || errorMsg.includes('invalid') || errorMsg.includes('Missing')) {
                // Don't retry these - they won't succeed
                return { data, error: null };
              }
            }

            return { data, error: null };
          },
          {
            maxRetries: 4,
            delayMs: 2000, // Start with 2 seconds, increases with backoff
            context: 'confirm-pending-tickets',
            shouldRetry: (error) => {
              // Always retry network errors and 503s since payment succeeded
              const errorMessage = error instanceof Error ? error.message : String(error);
              return errorMessage.includes('Network error') ||
                     errorMessage.includes('Failed to send') ||
                     errorMessage.includes('FunctionsFetchError') ||
                     errorMessage.includes('retriesExhausted') ||
                     errorMessage.includes('503') ||
                     errorMessage.includes('Service Unavailable') ||
                     isNetworkError(error);
            }
          }
        );
        confirmationSucceeded = confirmResult.data?.success === true;
      } catch (retryError) {
        // All retries exhausted
        console.error('Ticket confirmation failed after all retries:', retryError);
        confirmResult = { data: null, error: retryError };
      }

      if (!confirmationSucceeded) {
        // Ticket confirmation failed, but payment succeeded - needs attention
        console.error('Payment succeeded but ticket confirmation failed:', confirmResult.error || confirmResult.data?.error);

        // Update transaction with warning status and detailed error info
        await supabase
          .from('user_transactions')
          .update({
            status: 'completed',
            payment_status: 'finished',
            notes: `Payment completed but ticket confirmation needs review. Error: ${
              confirmResult.error?.message || confirmResult.data?.error || 'Unknown error'
            }. Confirmation body: ${JSON.stringify({
              reservationId: request.reservationId,
              competitionId: request.competitionId,
              ticketCount: request.ticketCount,
            })}`,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', transactionId);

        // Return success=false with specific error to inform user
        // Payment succeeded but they need to contact support for ticket allocation
        return {
          success: false,
          transactionId,
          transactionHash: paymentResult.transactionHash,
          status: 'completed',
          amount: totalAmount,
          ticketCount: 0,
          error: 'Payment completed successfully, but ticket allocation failed. Your payment has been received. Please contact support with your transaction ID to get your tickets allocated.',
          paymentSucceeded: true, // Flag to indicate payment actually succeeded
        };
      }

      return {
        success: true,
        transactionId,
        transactionHash: paymentResult.transactionHash,
        status: 'completed',
        amount: totalAmount,
        ticketCount: request.ticketCount,
      };
    } catch (error) {
      console.error('Ticket purchase error:', error);

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
        ticketCount: 0,
        error: error instanceof Error ? error.message : 'Purchase failed',
      };
    }
  }

  /**
   * Get the status of a transaction
   *
   * Normalizes various backend statuses into consistent values:
   * Success statuses: completed, finished, confirmed, success, paid → 'completed'
   * Failure statuses: failed, expired, cancelled, unresolved, error → 'failed'
   * Processing status: processing, confirming, sending → 'processing'
   * Otherwise: 'pending'
   */
  static async getTransactionStatus(transactionId: string): Promise<TransactionStatus> {
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
      } else if (status && isProcessingStatus(status)) {
        normalizedStatus = 'processing';
      }

      return {
        status: normalizedStatus,
        transactionHash: data?.tx_id,
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
   * Uses canonical_user_id (prize:pid format) for consistent lookups
   */
  static async getUserCompetitionPurchases(
    userId: string,
    competitionId: string
  ): Promise<any[]> {
    try {
      // Convert to canonical format for consistent lookups
      const canonicalUserId = toPrizePid(userId);
      const normalizedWallet = normalizeWalletAddress(userId);

      // Query by canonical_user_id or wallet_address
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
   * Uses canonical_user_id (prize:pid format) for consistent lookups
   */
  static async getUserPurchaseHistory(userId: string): Promise<any[]> {
    try {
      // Convert to canonical format for consistent lookups
      const canonicalUserId = toPrizePid(userId);
      const normalizedWallet = normalizeWalletAddress(userId);

      // Query by canonical_user_id or wallet_address
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

export default BasePaymentService;
