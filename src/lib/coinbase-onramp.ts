/**
 * Coinbase Onramp/Offramp Service - Client-side wrapper
 *
 * This module provides a client-side interface to Coinbase Onramp and Offramp
 * functionality. It handles:
 * - Session token generation for secure widget initialization
 * - Onramp URL generation for bringing fiat/crypto onchain
 * - Offramp URL generation for cashing out crypto to fiat
 * - Quote fetching for real-time pricing
 * - Transaction status checking
 *
 * Features:
 * - Apple Pay support for faster checkout
 * - Debit/Credit card payments
 * - Coinbase account integration for connected users
 * - Support for multiple networks and assets
 *
 * All sensitive operations are handled server-side via Supabase Edge Functions.
 */

// Supabase Edge Functions endpoints for Coinbase Onramp
const SUPABASE_FUNCTIONS_BASE = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1';

// Netlify function endpoint for session token generation
const NETLIFY_SESSION_TOKEN_ENDPOINT = '/.netlify/functions/onramp-session-token';

// Legacy Netlify endpoint (fallback)
const API_BASE = '/api/coinbase-onramp';

// Supabase onramp endpoints
export const ONRAMP_ENDPOINTS = {
  init: `${SUPABASE_FUNCTIONS_BASE}/onramp-init`,
  complete: `${SUPABASE_FUNCTIONS_BASE}/onramp-complete`,
  cancel: `${SUPABASE_FUNCTIONS_BASE}/onramp-cancel`,
  webhook: `${SUPABASE_FUNCTIONS_BASE}/onramp-webhook`,
  status: `${SUPABASE_FUNCTIONS_BASE}/onramp-status`,
  quote: `${SUPABASE_FUNCTIONS_BASE}/onramp-quote`,
  createOnrampUrl: `${SUPABASE_FUNCTIONS_BASE}/create-onramp-url`,
} as const;

// Supabase offramp endpoints
export const OFFRAMP_ENDPOINTS = {
  init: `${SUPABASE_FUNCTIONS_BASE}/offramp-init`,
  cancel: `${SUPABASE_FUNCTIONS_BASE}/offramp-cancel`,
  webhook: `${SUPABASE_FUNCTIONS_BASE}/offramp-webhook`,
  status: `${SUPABASE_FUNCTIONS_BASE}/offramp-status`,
  quote: `${SUPABASE_FUNCTIONS_BASE}/offramp-quote`,
} as const;

// Supported networks for onramp/offramp
export type SupportedNetwork = 'base' | 'base-sepolia' | 'ethereum' | string;

// Supported assets
export type SupportedAsset = 'USDC' | 'ETH' | 'WETH' | string;

// Supported fiat currencies
export type SupportedFiatCurrency = 'USD' | 'EUR' | 'GBP' | string;

// Payment methods
export type PaymentMethod = 'CARD' | 'ACH_BANK_ACCOUNT' | 'COINBASE_BALANCE' | 'APPLE_PAY';

export interface OnrampConfig {
  supportedNetworks: SupportedNetwork[];
  supportedAssets: SupportedAsset[];
  supportedFiatCurrencies: SupportedFiatCurrency[];
  // Card payments configuration - replaces guestCheckout
  cardPayments: {
    enabled: boolean;
    minAmount: number;
    maxAmount: number;
    weeklyLimit: number;
    supportedMethods: string[];
  };
  coinbaseAccount: {
    enabled: boolean;
    paymentMethods: string[];
  };
}

export interface OnrampUrlParams {
  destinationAddress: string;
  destinationAsset?: SupportedAsset;
  destinationNetwork?: SupportedNetwork;
  fiatCurrency?: SupportedFiatCurrency;
  fiatAmount?: number;
  partnerUserId?: string;
  redirectUrl?: string;
}

export interface OfframpUrlParams {
  sourceAddress: string;
  sourceAsset?: SupportedAsset;
  sourceNetwork?: SupportedNetwork;
  fiatCurrency?: SupportedFiatCurrency;
  partnerUserId?: string;
  redirectUrl?: string;
}

export interface OnrampUrlResult {
  url: string;
  sessionToken: string;
  destinationAddress: string;
  destinationAsset: string;
  destinationNetwork: string;
}

export interface OfframpUrlResult {
  url: string;
  sessionToken: string;
  sourceAddress: string;
  sourceAsset: string;
  sourceNetwork: string;
}

export interface SessionTokenResult {
  sessionToken: string;
  destinationAddress: string;
}

// Types for the dynamic create-onramp-url endpoint
export interface CreateOnrampUrlParams {
  amount: number;
  walletAddress: string;
  userId: string;
}

export interface CreateOnrampUrlResult {
  hosted_url: string;
}

// New types for Supabase Edge Functions
export interface OnrampInitParams {
  destinationAddress: string;
  destinationNetwork?: SupportedNetwork;
  assets?: SupportedAsset[];
  fiatCurrency?: SupportedFiatCurrency;
  presetFiatAmount?: number;
  presetCryptoAmount?: number;
  defaultAsset?: SupportedAsset;
  defaultPaymentMethod?: PaymentMethod;
  partnerUserRef?: string;
  redirectUrl?: string;
  defaultExperience?: 'send' | 'buy';
}

export interface OnrampInitResult {
  sessionToken: string;
  url: string;
  destinationAddress: string;
  destinationNetwork: string;
  defaultAsset: string;
  expiresIn: number;
}

export interface OnrampQuoteParams {
  purchaseCurrency: string;
  purchaseNetwork?: string;
  paymentCurrency?: string;
  paymentAmount: string;
  paymentMethod?: string;
  country?: string;
}

export interface OnrampQuoteResult {
  quoteId: string;
  purchaseAmount: { value: string; currency: string };
  paymentSubtotal: { value: string; currency: string };
  paymentTotal: { value: string; currency: string };
  coinbaseFee: { value: string; currency: string };
  networkFee: { value: string; currency: string };
  exchangeRate: string;
  expiresAt: string;
  cryptoAmount: string;
  cryptoCurrency: string;
  fiatAmount: string;
  fiatCurrency: string;
  totalFees: string;
}

export interface OnrampStatusParams {
  transactionId?: string;
  partnerUserRef?: string;
  checkCoinbase?: boolean;
}

export interface OnrampTransactionStatus {
  id: string;
  status: string;
  paymentStatus: string;
  amount?: number;
  currency?: string;
  cryptoAmount?: string;
  cryptoCurrency?: string;
  network?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================
// OFFRAMP TYPES - Supabase Edge Functions
// ============================================

export interface OfframpInitParams {
  sourceAddress: string;
  sourceNetwork?: SupportedNetwork;
  sourceAsset?: SupportedAsset;
  fiatCurrency?: SupportedFiatCurrency;
  amount?: number;
  partnerUserRef?: string;
  redirectUrl?: string;
}

export interface OfframpInitResult {
  sessionToken: string;
  url: string;
  sourceAddress: string;
  sourceNetwork: string;
  sourceAsset: string;
  expiresIn: number;
}

export interface OfframpQuoteParams {
  sellCurrency: string;
  sellNetwork?: string;
  cashoutCurrency?: string;
  sellAmount: string;
  country?: string;
}

export interface OfframpQuoteResult {
  quoteId: string;
  sellAmount: { value: string; currency: string };
  cashoutAmount: { value: string; currency: string };
  coinbaseFee: { value: string; currency: string };
  networkFee: { value: string; currency: string };
  exchangeRate: string;
  expiresAt: string;
}

export interface OfframpStatusParams {
  payoutId?: string;
  partnerUserRef?: string;
}

export interface OfframpPayoutStatus {
  id: string;
  status: string;
  cryptoAmount?: string;
  cryptoCurrency?: string;
  fiatAmount?: string;
  fiatCurrency?: string;
  network?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Helper to make API calls to the Coinbase Onramp function (Netlify - legacy)
 */
async function callOnrampApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: T; error?: string }> {
  const url = `${API_BASE}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Request failed with status ${response.status}`,
      };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Coinbase Onramp API call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

// Supabase anon key for Edge Function authentication
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Helper to call Supabase Edge Functions for Coinbase Onramp
 */
async function callSupabaseOnrampApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: T; error?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add Supabase anon key for authentication
  if (SUPABASE_ANON_KEY) {
    headers['apikey'] = SUPABASE_ANON_KEY;
    headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(endpoint, options);
    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || data.message || `Request failed with status ${response.status}`,
      };
    }

    return { success: true, data: data.data || data };
  } catch (error) {
    console.error('Supabase Onramp API call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export class CoinbaseOnrampService {
  /**
   * Get a session token from the Netlify function
   *
   * This is the recommended method for getting session tokens as it uses
   * server-side credentials and avoids 401 errors from browser-based requests.
   *
   * @param address - The wallet address to create the session for
   * @param chainId - The chain ID (default: 8453 for Base mainnet)
   */
  static async getSessionToken(
    address: string,
    chainId: number = 8453
  ): Promise<string> {
    try {
      const response = await fetch(NETLIFY_SESSION_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address, chainId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to get session token: ${response.status}`);
      }

      const data = await response.json();
      return data.sessionToken || data.token;
    } catch (error) {
      console.error('Error fetching session token from Netlify function:', error);
      throw error;
    }
  }

  /**
   * Get the onramp configuration (supported networks, assets, payment methods)
   */
  static async getConfig(): Promise<OnrampConfig> {
    const result = await callOnrampApi<{ config: OnrampConfig }>('/config', 'GET');

    if (!result.success || !result.data?.config) {
      throw new Error(result.error || 'Failed to get onramp configuration');
    }

    return result.data.config;
  }

  /**
   * Generate a session token for the Coinbase widget
   *
   * @param destinationAddress - The wallet address to receive funds
   * @param destinationNetwork - The blockchain network (default: 'base')
   */
  static async generateSessionToken(
    destinationAddress: string,
    destinationNetwork: SupportedNetwork = 'base'
  ): Promise<SessionTokenResult> {
    const result = await callOnrampApi<SessionTokenResult>('/session', 'POST', {
      destinationAddress,
      destinationNetwork,
    });

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to generate session token');
    }

    return result.data;
  }

  /**
   * Generate an onramp URL for bringing funds onchain
   *
   * This URL can be opened in a new window/tab or embedded iframe.
   * Users can pay with:
   * - Apple Pay (for supported devices)
   * - Debit/Credit card
   * - Coinbase account (fiat or crypto balances)
   *
   * @param params - Onramp URL parameters
   */
  static async generateOnrampUrl(params: OnrampUrlParams): Promise<OnrampUrlResult> {
    const errors: string[] = [];

    // Try Supabase Edge Function first (works in both local and production)
    try {
      console.log('[Onramp] Trying Supabase Edge Function...');
      const result = await this.initOnramp({
        destinationAddress: params.destinationAddress,
        destinationNetwork: params.destinationNetwork || 'base',
        assets: [params.destinationAsset || 'USDC'],
        fiatCurrency: params.fiatCurrency || 'USD',
        presetFiatAmount: params.fiatAmount,
        defaultAsset: params.destinationAsset || 'USDC',
        partnerUserRef: params.partnerUserId,
        redirectUrl: params.redirectUrl,
      });

      console.log('[Onramp] Supabase Edge Function succeeded');
      return {
        url: result.url,
        sessionToken: result.sessionToken,
        destinationAddress: result.destinationAddress,
        destinationAsset: result.defaultAsset,
        destinationNetwork: result.destinationNetwork,
      };
    } catch (supabaseError) {
      const errMsg = supabaseError instanceof Error ? supabaseError.message : String(supabaseError);
      console.warn('[Onramp] Supabase Edge Function failed:', errMsg);
      errors.push(`Supabase: ${errMsg}`);
    }

    // Fallback to Netlify function
    try {
      console.log('[Onramp] Trying Netlify function...');
      const result = await callOnrampApi<OnrampUrlResult>('/url', 'POST', {
        destinationAddress: params.destinationAddress,
        destinationAsset: params.destinationAsset || 'USDC',
        destinationNetwork: params.destinationNetwork || 'base',
        fiatCurrency: params.fiatCurrency || 'USD',
        fiatAmount: params.fiatAmount,
        partnerUserId: params.partnerUserId,
        redirectUrl: params.redirectUrl,
      });

      if (result.success && result.data) {
        console.log('[Onramp] Netlify function succeeded');
        return result.data;
      }
      
      errors.push(`Netlify: ${result.error || 'Unknown error'}`);
    } catch (netlifyError) {
      const errMsg = netlifyError instanceof Error ? netlifyError.message : String(netlifyError);
      console.warn('[Onramp] Netlify function failed:', errMsg);
      errors.push(`Netlify: ${errMsg}`);
    }

    // Both failed - throw comprehensive error
    throw new Error(`Failed to generate onramp URL. Errors: ${errors.join('; ')}`);
  }

  /**
   * Generate an offramp URL for cashing out crypto to fiat
   *
   * This URL allows users to convert their crypto to fiat and
   * send funds directly to their bank account (ACH) or Coinbase account.
   *
   * @param params - Offramp URL parameters
   */
  static async generateOfframpUrl(params: OfframpUrlParams): Promise<OfframpUrlResult> {
    const result = await callOnrampApi<OfframpUrlResult>('/offramp/url', 'POST', {
      sourceAddress: params.sourceAddress,
      sourceAsset: params.sourceAsset || 'USDC',
      sourceNetwork: params.sourceNetwork || 'base',
      fiatCurrency: params.fiatCurrency || 'USD',
      partnerUserId: params.partnerUserId,
      redirectUrl: params.redirectUrl,
    });

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to generate offramp URL');
    }

    return result.data;
  }

  /**
   * Open the onramp widget in a new window
   *
   * @param url - The onramp URL to open
   * @param windowName - Name for the popup window
   */
  static openOnrampWindow(url: string, windowName: string = 'coinbase_onramp'): Window | null {
    const width = 450;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    return window.open(
      url,
      windowName,
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
    );
  }

  /**
   * Open the offramp widget in a new window
   *
   * @param url - The offramp URL to open
   * @param windowName - Name for the popup window
   */
  static openOfframpWindow(url: string, windowName: string = 'coinbase_offramp'): Window | null {
    return this.openOnrampWindow(url, windowName);
  }

  /**
   * Get supported networks for onramp/offramp
   */
  static getSupportedNetworks(): SupportedNetwork[] {
    return ['base', 'base-sepolia', 'ethereum'];
  }

  /**
   * Get supported assets for onramp/offramp
   */
  static getSupportedAssets(): SupportedAsset[] {
    return ['USDC', 'ETH', 'WETH'];
  }

  /**
   * Get supported fiat currencies
   */
  static getSupportedFiatCurrencies(): SupportedFiatCurrency[] {
    return ['USD', 'EUR', 'GBP'];
  }

  /**
   * Check if the amount is within valid card payment limits
   *
   * Card payments via Coinbase Onramp support amounts from $1 to $10,000.
   * Apple Pay, debit cards, and Coinbase account payments are all supported.
   *
   * @param amount - The fiat amount to check
   */
  static isGuestCheckoutAvailable(amount: number): boolean {
    return amount >= 1 && amount <= 10000;
  }

  /**
   * Get the minimum transaction amount for card payments
   */
  static getMinGuestCheckoutAmount(): number {
    return 1;
  }

  /**
   * Get the maximum transaction amount for card payments
   */
  static getMaxGuestCheckoutAmount(): number {
    return 10000;
  }

  /**
   * Get the weekly limit for card payments
   */
  static getGuestCheckoutWeeklyLimit(): number {
    return 10000;
  }

  // ============================================
  // NEW METHODS - Supabase Edge Functions
  // ============================================

  /**
   * Initialize an onramp session via Supabase Edge Function
   *
   * This is the preferred method for creating onramp sessions.
   * It uses the Supabase Edge Function which handles JWT generation
   * and session token creation.
   *
   * @param params - Onramp initialization parameters
   */
  static async initOnramp(params: OnrampInitParams): Promise<OnrampInitResult> {
    const result = await callSupabaseOnrampApi<OnrampInitResult>(
      ONRAMP_ENDPOINTS.init,
      'POST',
      {
        destinationAddress: params.destinationAddress,
        destinationNetwork: params.destinationNetwork || 'base',
        assets: params.assets || ['USDC', 'ETH'],
        fiatCurrency: params.fiatCurrency || 'USD',
        presetFiatAmount: params.presetFiatAmount,
        presetCryptoAmount: params.presetCryptoAmount,
        defaultAsset: params.defaultAsset || 'USDC',
        defaultPaymentMethod: params.defaultPaymentMethod || 'CARD',
        partnerUserRef: params.partnerUserRef,
        redirectUrl: params.redirectUrl,
        defaultExperience: params.defaultExperience || 'buy',
      }
    );

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to initialize onramp session');
    }

    return result.data;
  }

  /**
   * Get a quote for an onramp transaction via Supabase Edge Function
   *
   * This provides real-time pricing information including fees and exchange rates.
   *
   * @param params - Quote parameters
   */
  static async getQuote(params: OnrampQuoteParams): Promise<OnrampQuoteResult> {
    const result = await callSupabaseOnrampApi<OnrampQuoteResult>(
      ONRAMP_ENDPOINTS.quote,
      'POST',
      {
        purchaseCurrency: params.purchaseCurrency,
        purchaseNetwork: params.purchaseNetwork || 'base',
        paymentCurrency: params.paymentCurrency || 'USD',
        paymentAmount: params.paymentAmount,
        paymentMethod: params.paymentMethod || 'CARD',
        country: params.country || 'US',
      }
    );

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to get onramp quote');
    }

    return result.data;
  }

  /**
   * Check the status of an onramp transaction via Supabase Edge Function
   *
   * @param params - Status check parameters
   */
  static async getTransactionStatus(params: OnrampStatusParams): Promise<OnrampTransactionStatus | null> {
    const queryParams = new URLSearchParams();
    if (params.transactionId) queryParams.set('transactionId', params.transactionId);
    if (params.partnerUserRef) queryParams.set('partnerUserRef', params.partnerUserRef);
    if (params.checkCoinbase) queryParams.set('checkCoinbase', 'true');

    const url = `${ONRAMP_ENDPOINTS.status}?${queryParams.toString()}`;

    const result = await callSupabaseOnrampApi<{ transaction: OnrampTransactionStatus }>(
      url,
      'GET'
    );

    if (!result.success) {
      console.error('Failed to get transaction status:', result.error);
      return null;
    }

    return result.data?.transaction || null;
  }

  /**
   * Build the redirect URLs for onramp completion/cancellation
   *
   * These URLs should be passed to the onramp widget so users are
   * redirected back to the app after completing or cancelling.
   */
  static getRedirectUrls(baseUrl: string = 'https://theprize.io'): {
    completeUrl: string;
    cancelUrl: string;
  } {
    return {
      completeUrl: `${baseUrl}/wallet?onramp_status=complete`,
      cancelUrl: `${baseUrl}/wallet?onramp_status=cancelled`,
    };
  }

  /**
   * Build onramp URL with redirect handlers using Supabase endpoints
   *
   * This is a convenience method that sets up proper redirect URLs
   * for completion and cancellation handling.
   */
  static async initOnrampWithRedirects(
    params: Omit<OnrampInitParams, 'redirectUrl'>,
    baseUrl: string = 'https://theprize.io'
  ): Promise<OnrampInitResult> {
    const { completeUrl } = this.getRedirectUrls(baseUrl);

    return this.initOnramp({
      ...params,
      redirectUrl: completeUrl,
    });
  }

  // ============================================
  // OFFRAMP METHODS - Supabase Edge Functions
  // ============================================

  /**
   * Initialize an offramp session via Supabase Edge Function
   *
   * This creates a session for users to convert crypto to fiat.
   * The session token is used to open the Coinbase offramp widget.
   *
   * @param params - Offramp initialization parameters
   */
  static async initOfframp(params: OfframpInitParams): Promise<OfframpInitResult> {
    const result = await callSupabaseOnrampApi<OfframpInitResult>(
      OFFRAMP_ENDPOINTS.init,
      'POST',
      {
        sourceAddress: params.sourceAddress,
        sourceNetwork: params.sourceNetwork || 'base',
        sourceAsset: params.sourceAsset || 'USDC',
        fiatCurrency: params.fiatCurrency || 'USD',
        amount: params.amount,
        partnerUserRef: params.partnerUserRef,
        redirectUrl: params.redirectUrl,
      }
    );

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to initialize offramp session');
    }

    return result.data;
  }

  /**
   * Get a quote for an offramp transaction via Supabase Edge Function
   *
   * This provides real-time pricing for converting crypto to fiat.
   *
   * @param params - Quote parameters
   */
  static async getOfframpQuote(params: OfframpQuoteParams): Promise<OfframpQuoteResult> {
    const result = await callSupabaseOnrampApi<OfframpQuoteResult>(
      OFFRAMP_ENDPOINTS.quote,
      'POST',
      {
        sellCurrency: params.sellCurrency,
        sellNetwork: params.sellNetwork || 'base',
        cashoutCurrency: params.cashoutCurrency || 'USD',
        sellAmount: params.sellAmount,
        country: params.country || 'US',
      }
    );

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to get offramp quote');
    }

    return result.data;
  }

  /**
   * Check the status of an offramp payout via Supabase Edge Function
   *
   * @param params - Status check parameters
   */
  static async getOfframpStatus(params: OfframpStatusParams): Promise<OfframpPayoutStatus | null> {
    const queryParams = new URLSearchParams();
    if (params.payoutId) queryParams.set('payoutId', params.payoutId);
    if (params.partnerUserRef) queryParams.set('partnerUserRef', params.partnerUserRef);

    const url = `${OFFRAMP_ENDPOINTS.status}?${queryParams.toString()}`;

    const result = await callSupabaseOnrampApi<{ payout: OfframpPayoutStatus }>(
      url,
      'GET'
    );

    if (!result.success) {
      console.error('Failed to get offramp status:', result.error);
      return null;
    }

    return result.data?.payout || null;
  }

  /**
   * Cancel an offramp payout via Supabase Edge Function
   *
   * @param payoutId - The payout ID to cancel
   */
  static async cancelOfframp(payoutId: string): Promise<boolean> {
    const result = await callSupabaseOnrampApi<{ success: boolean }>(
      OFFRAMP_ENDPOINTS.cancel,
      'POST',
      { payoutId }
    );

    return result.success;
  }

  /**
   * Build the redirect URLs for offramp completion/cancellation
   */
  static getOfframpRedirectUrls(baseUrl: string = 'https://theprize.io'): {
    completeUrl: string;
    cancelUrl: string;
  } {
    return {
      completeUrl: `${baseUrl}/wallet?offramp_status=complete`,
      cancelUrl: `${baseUrl}/wallet?offramp_status=cancelled`,
    };
  }

  /**
   * Initialize offramp with redirect handlers using Supabase endpoints
   *
   * This is a convenience method that sets up proper redirect URLs
   * for completion and cancellation handling.
   */
  static async initOfframpWithRedirects(
    params: Omit<OfframpInitParams, 'redirectUrl'>,
    baseUrl: string = 'https://theprize.io'
  ): Promise<OfframpInitResult> {
    const { completeUrl } = this.getOfframpRedirectUrls(baseUrl);

    return this.initOfframp({
      ...params,
      redirectUrl: completeUrl,
    });
  }

  // ============================================
  // DYNAMIC ONRAMP URL - Supabase Edge Function
  // ============================================

  /**
   * Create a dynamic onramp URL via the Supabase Edge Function
   *
   * This is a simplified endpoint that creates a hosted checkout URL
   * for any amount. The URL opens in a new window and allows the user
   * to complete the purchase using card, Apple Pay, Google Pay, etc.
   *
   * @param params - Parameters for the onramp URL
   * @returns The hosted URL to redirect the user to
   */
  static async createDynamicOnrampUrl(params: CreateOnrampUrlParams): Promise<string> {
    const { amount, walletAddress, userId } = params;

    if (!amount || amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }
    if (!userId) {
      throw new Error('User ID is required');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add Supabase anon key for authentication
    if (SUPABASE_ANON_KEY) {
      headers['apikey'] = SUPABASE_ANON_KEY;
      headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
    }

    try {
      const response = await fetch(ONRAMP_ENDPOINTS.createOnrampUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount,
          walletAddress,
          userId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
      }

      if (!data.hosted_url) {
        throw new Error('No hosted_url returned from create-onramp-url endpoint');
      }

      return data.hosted_url;
    } catch (error) {
      console.error('[Onramp] Failed to create dynamic onramp URL:', error);
      throw error;
    }
  }
}

// Export configuration constants
export const ONRAMP_CONFIG = {
  SUPPORTED_NETWORKS: ['base', 'base-sepolia', 'ethereum'] as const,
  SUPPORTED_ASSETS: ['USDC', 'ETH', 'WETH'] as const,
  SUPPORTED_FIAT_CURRENCIES: ['USD', 'EUR', 'GBP'] as const,
  DEFAULT_NETWORK: 'base' as const,
  DEFAULT_ASSET: 'USDC' as const,
  DEFAULT_FIAT_CURRENCY: 'USD' as const,
  // Card payment limits (applies when not using Coinbase account)
  CARD_PAYMENTS: {
    MIN_AMOUNT: 1,
    MAX_AMOUNT: 10000,
    WEEKLY_LIMIT: 10000,
  },
  // Countries where Coinbase Onramp card payments are supported
  // Source: Coinbase Onramp documentation
  SUPPORTED_CARD_COUNTRIES: [
    'US', // United States
    'CA', // Canada (limited)
    'GB', // United Kingdom
    'DE', // Germany
    'FR', // France
    'ES', // Spain
    'IT', // Italy
    'NL', // Netherlands
    'AT', // Austria
    'BE', // Belgium
    'IE', // Ireland
    'PT', // Portugal
    'FI', // Finland
    'SE', // Sweden
    'NO', // Norway
    'DK', // Denmark
    'PL', // Poland
    'CZ', // Czech Republic
    'AU', // Australia
    'SG', // Singapore
    'JP', // Japan
  ],
} as const;

/**
 * Check if a country supports Coinbase Onramp card payments
 * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., 'US', 'GB')
 */
export function isOnrampAvailableInCountry(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return ONRAMP_CONFIG.SUPPORTED_CARD_COUNTRIES.includes(countryCode.toUpperCase() as any);
}

/**
 * Get user's country code from browser (using various methods)
 * Returns null if country cannot be determined
 */
export async function detectUserCountry(): Promise<string | null> {
  try {
    // Try navigator.language first (gives locale like 'en-US')
    if (navigator.language) {
      const parts = navigator.language.split('-');
      if (parts.length >= 2) {
        const country = parts[parts.length - 1].toUpperCase();
        if (country.length === 2) {
          return country;
        }
      }
    }

    // Try Intl.DateTimeFormat timezone-based detection (rough estimate)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) {
      // Common timezone to country mappings
      const timezoneCountries: Record<string, string> = {
        'America/New_York': 'US',
        'America/Chicago': 'US',
        'America/Los_Angeles': 'US',
        'America/Denver': 'US',
        'Europe/London': 'GB',
        'Europe/Paris': 'FR',
        'Europe/Berlin': 'DE',
        'Europe/Madrid': 'ES',
        'Europe/Rome': 'IT',
        'Europe/Amsterdam': 'NL',
        'Europe/Dublin': 'IE',
        'Europe/Stockholm': 'SE',
        'Europe/Oslo': 'NO',
        'Europe/Copenhagen': 'DK',
        'Europe/Helsinki': 'FI',
        'Europe/Warsaw': 'PL',
        'Europe/Prague': 'CZ',
        'Europe/Vienna': 'AT',
        'Europe/Brussels': 'BE',
        'Europe/Lisbon': 'PT',
        'Australia/Sydney': 'AU',
        'Asia/Singapore': 'SG',
        'Asia/Tokyo': 'JP',
        'America/Toronto': 'CA',
        'America/Vancouver': 'CA',
      };

      if (timezoneCountries[timezone]) {
        return timezoneCountries[timezone];
      }
    }

    return null;
  } catch (error) {
    console.error('Error detecting user country:', error);
    return null;
  }
}

export default CoinbaseOnrampService;
