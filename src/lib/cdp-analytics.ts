/**
 * CDP Analytics Service - Client-side wrapper
 *
 * This module provides a client-side interface for managing CDP webhook subscriptions
 * and monitoring on-chain activity. It communicates with the Netlify functions that
 * handle the actual CDP API calls.
 *
 * Features:
 * - Create webhook subscriptions for smart contract events
 * - List, view, update, and delete subscriptions
 * - Pre-configured monitoring for common contracts (USDC)
 *
 * @see https://docs.cdp.coinbase.com/developer-platform/docs/webhooks-onchain-activity
 */

import type {
  CDPWebhookSubscription,
  CDPCreateSubscriptionRequest,
  CDPUpdateSubscriptionRequest,
  CDPWebhookLabels,
  CDPNetwork,
  CDP_MONITORED_CONTRACTS,
  CDP_EVENT_SIGNATURES,
} from '../types/cdp-analytics';

const CDP_ANALYTICS_API_BASE = '/api/cdp-analytics';

/**
 * API response wrapper
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Helper to make API calls to the CDP analytics functions
 */
async function callCdpAnalyticsApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const url = `${CDP_ANALYTICS_API_BASE}${endpoint}`;

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
    console.error('CDP Analytics API call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Create subscription response
 */
interface CreateSubscriptionResponse {
  success: boolean;
  subscription: CDPWebhookSubscription;
}

/**
 * List subscriptions response
 */
interface ListSubscriptionsResponse {
  success: boolean;
  subscriptions: CDPWebhookSubscription[];
}

/**
 * Get subscription response
 */
interface GetSubscriptionResponse {
  success: boolean;
  subscription: CDPWebhookSubscription;
}

/**
 * CDP Analytics Service
 *
 * Provides methods for managing CDP webhook subscriptions for on-chain activity monitoring.
 */
export class CdpAnalyticsService {
  /**
   * Create a new webhook subscription to monitor smart contract events.
   *
   * @param params - Subscription configuration
   * @returns Created subscription with webhook secret
   *
   * @example
   * ```typescript
   * const subscription = await CdpAnalyticsService.createSubscription({
   *   description: 'Monitor USDC Transfers',
   *   target: {
   *     url: 'https://your-site.netlify.app/api/cdp-analytics/webhook',
   *     method: 'POST',
   *   },
   *   labels: {
   *     contract_address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
   *     event_name: 'Transfer',
   *     network: 'base-mainnet',
   *   },
   * });
   * // Save subscription.metadata?.secret for webhook verification
   * ```
   */
  static async createSubscription(
    params: CDPCreateSubscriptionRequest
  ): Promise<CDPWebhookSubscription> {
    const result = await callCdpAnalyticsApi<CreateSubscriptionResponse>(
      '/subscriptions',
      'POST',
      params as unknown as Record<string, unknown>
    );

    if (!result.success || !result.data?.subscription) {
      throw new Error(result.error || 'Failed to create subscription');
    }

    return result.data.subscription;
  }

  /**
   * List all webhook subscriptions.
   *
   * @returns Array of subscriptions
   */
  static async listSubscriptions(): Promise<CDPWebhookSubscription[]> {
    const result = await callCdpAnalyticsApi<ListSubscriptionsResponse>(
      '/subscriptions',
      'GET'
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to list subscriptions');
    }

    return result.data?.subscriptions || [];
  }

  /**
   * Get details for a specific subscription.
   *
   * @param subscriptionId - The subscription ID
   * @returns Subscription details
   */
  static async getSubscription(subscriptionId: string): Promise<CDPWebhookSubscription> {
    const result = await callCdpAnalyticsApi<GetSubscriptionResponse>(
      `/subscriptions/${subscriptionId}`,
      'GET'
    );

    if (!result.success || !result.data?.subscription) {
      throw new Error(result.error || 'Failed to get subscription');
    }

    return result.data.subscription;
  }

  /**
   * Update an existing subscription.
   *
   * @param subscriptionId - The subscription ID
   * @param updates - Fields to update
   * @returns Updated subscription
   */
  static async updateSubscription(
    subscriptionId: string,
    updates: CDPUpdateSubscriptionRequest
  ): Promise<CDPWebhookSubscription> {
    const result = await callCdpAnalyticsApi<GetSubscriptionResponse>(
      `/subscriptions/${subscriptionId}`,
      'PUT',
      updates as unknown as Record<string, unknown>
    );

    if (!result.success || !result.data?.subscription) {
      throw new Error(result.error || 'Failed to update subscription');
    }

    return result.data.subscription;
  }

  /**
   * Delete a subscription.
   *
   * @param subscriptionId - The subscription ID
   */
  static async deleteSubscription(subscriptionId: string): Promise<void> {
    const result = await callCdpAnalyticsApi<{ success: boolean }>(
      `/subscriptions/${subscriptionId}`,
      'DELETE'
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete subscription');
    }
  }

  /**
   * Enable a subscription.
   *
   * @param subscriptionId - The subscription ID
   */
  static async enableSubscription(subscriptionId: string): Promise<CDPWebhookSubscription> {
    return this.updateSubscription(subscriptionId, { isEnabled: true });
  }

  /**
   * Disable a subscription.
   *
   * @param subscriptionId - The subscription ID
   */
  static async disableSubscription(subscriptionId: string): Promise<CDPWebhookSubscription> {
    return this.updateSubscription(subscriptionId, { isEnabled: false });
  }

  // ============================================================================
  // Pre-configured Subscription Templates
  // ============================================================================

  /**
   * Create a subscription to monitor USDC transfers on Base.
   *
   * @param webhookUrl - Your webhook endpoint URL
   * @param network - Network to monitor (default: base-mainnet)
   * @param options - Additional configuration
   */
  static async createUsdcTransferSubscription(
    webhookUrl: string,
    network: CDPNetwork = 'base-mainnet',
    options?: {
      /** Only monitor transfers from this address */
      fromAddress?: string;
      /** Only monitor transfers to this address */
      toAddress?: string;
      /** Custom description */
      description?: string;
      /** Custom headers for the webhook */
      headers?: Record<string, string>;
    }
  ): Promise<CDPWebhookSubscription> {
    const contractAddress = network === 'base-mainnet'
      ? '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' // USDC on Base Mainnet
      : '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // USDC on Base Sepolia

    const labels: CDPWebhookLabels = {
      contract_address: contractAddress,
      event_name: 'Transfer',
      network,
    };

    // Add optional address filters
    if (options?.fromAddress) {
      labels['params.from'] = options.fromAddress;
    }
    if (options?.toAddress) {
      labels['params.to'] = options.toAddress;
    }

    return this.createSubscription({
      description: options?.description || `USDC Transfers on ${network}`,
      target: {
        url: webhookUrl,
        method: 'POST',
        headers: options?.headers,
      },
      labels,
      eventTypes: ['onchain.activity.detected'],
      isEnabled: true,
    });
  }

  /**
   * Create a subscription to monitor any ERC-20 transfers.
   *
   * @param webhookUrl - Your webhook endpoint URL
   * @param contractAddress - The token contract address
   * @param options - Additional configuration
   */
  static async createTokenTransferSubscription(
    webhookUrl: string,
    contractAddress: string,
    options?: {
      network?: CDPNetwork;
      fromAddress?: string;
      toAddress?: string;
      description?: string;
      headers?: Record<string, string>;
    }
  ): Promise<CDPWebhookSubscription> {
    const network = options?.network || 'base-mainnet';

    const labels: CDPWebhookLabels = {
      contract_address: contractAddress,
      event_name: 'Transfer',
      network,
    };

    if (options?.fromAddress) {
      labels['params.from'] = options.fromAddress;
    }
    if (options?.toAddress) {
      labels['params.to'] = options.toAddress;
    }

    return this.createSubscription({
      description: options?.description || `Token Transfers for ${contractAddress.slice(0, 10)}...`,
      target: {
        url: webhookUrl,
        method: 'POST',
        headers: options?.headers,
      },
      labels,
      eventTypes: ['onchain.activity.detected'],
      isEnabled: true,
    });
  }

  /**
   * Create a subscription to monitor custom smart contract events.
   *
   * @param webhookUrl - Your webhook endpoint URL
   * @param contractAddress - The contract address
   * @param eventNameOrSignature - Event name (e.g., "Transfer") or full signature
   * @param options - Additional configuration
   */
  static async createCustomEventSubscription(
    webhookUrl: string,
    contractAddress: string,
    eventNameOrSignature: string,
    options?: {
      network?: CDPNetwork;
      description?: string;
      headers?: Record<string, string>;
      params?: Record<string, string>;
    }
  ): Promise<CDPWebhookSubscription> {
    const network = options?.network || 'base-mainnet';
    const isSignature = eventNameOrSignature.includes('(');

    const labels: CDPWebhookLabels = {
      contract_address: contractAddress,
      network,
    };

    if (isSignature) {
      labels.event_signature = eventNameOrSignature;
    } else {
      labels.event_name = eventNameOrSignature;
    }

    // Add custom param filters
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        labels[`params.${key}`] = value;
      }
    }

    return this.createSubscription({
      description: options?.description || `${eventNameOrSignature} events on ${contractAddress.slice(0, 10)}...`,
      target: {
        url: webhookUrl,
        method: 'POST',
        headers: options?.headers,
      },
      labels,
      eventTypes: ['onchain.activity.detected'],
      isEnabled: true,
    });
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get the webhook URL for this site.
   * Uses the current origin or environment variable.
   */
  static getWebhookUrl(): string {
    // In browser, use current origin
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/api/cdp-analytics/webhook`;
    }

    // Fallback for SSR or if origin not available
    const siteUrl = import.meta.env?.VITE_SITE_URL || 'https://theprize.io';
    return `${siteUrl}/api/cdp-analytics/webhook`;
  }

  /**
   * Get known contract addresses.
   */
  static getKnownContracts() {
    return {
      USDC_BASE_MAINNET: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      USDC_BASE_SEPOLIA: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      USD_BASE_COIN: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
    };
  }

  /**
   * Get common event signatures.
   */
  static getEventSignatures() {
    return {
      TRANSFER: 'Transfer(address,address,uint256)',
      APPROVAL: 'Approval(address,address,uint256)',
    };
  }
}

export default CdpAnalyticsService;
