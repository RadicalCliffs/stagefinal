/**
 * CDP Analytics Types
 *
 * TypeScript type definitions for Coinbase Developer Platform webhook analytics.
 * Covers on-chain activity detection events and webhook subscription management.
 *
 * @see https://docs.cdp.coinbase.com/developer-platform/docs/webhooks-onchain-activity
 */

/**
 * CDP Webhook Event Types
 */
export type CDPEventType = 'onchain.activity.detected';

/**
 * CDP Supported Networks
 */
export type CDPNetwork = 'base-mainnet' | 'base-sepolia';

/**
 * On-chain Activity Event Data
 * Received when a monitored smart contract event is detected
 */
export interface CDPOnchainActivityData {
  /** Subscription ID that triggered this event */
  subscriptionId: string;

  /** Network where the event occurred */
  networkId: CDPNetwork;

  /** Block number where the event was detected */
  blockNumber: number;

  /** Block hash */
  blockHash: string;

  /** Transaction hash that emitted the event */
  transactionHash: string;

  /** Log index within the transaction */
  logIndex: number;

  /** Smart contract address that emitted the event */
  contractAddress: string;

  /** Event name (e.g., "Transfer") */
  eventName: string;

  /** Decoded event parameters - varies by event type */
  [key: string]: unknown;
}

/**
 * Transfer Event Data
 * Common ERC-20 Transfer event parameters
 */
export interface CDPTransferEventData extends CDPOnchainActivityData {
  eventName: 'Transfer';
  from: string;
  to: string;
  value: string;
}

/**
 * Approval Event Data
 * Common ERC-20 Approval event parameters
 */
export interface CDPApprovalEventData extends CDPOnchainActivityData {
  eventName: 'Approval';
  owner: string;
  spender: string;
  value: string;
}

/**
 * CDP Webhook Event Payload
 * Root structure received from CDP webhooks
 */
export interface CDPWebhookEvent {
  /** Unique event identifier */
  id: string;

  /** Event type */
  type: CDPEventType;

  /** Timestamp when the event was created */
  createdAt: string;

  /** Event data */
  data: CDPOnchainActivityData;
}

/**
 * CDP Webhook Signature Header Components
 * Parsed from X-Hook0-Signature header
 */
export interface CDPSignatureComponents {
  /** Unix timestamp when the webhook was sent */
  timestamp: string;

  /** Space-separated list of header names included in signature */
  headerNames: string;

  /** HMAC-SHA256 signature in hex format */
  signature: string;
}

/**
 * CDP Webhook Subscription Target
 */
export interface CDPWebhookTarget {
  /** Webhook endpoint URL (must be HTTPS) */
  url: string;

  /** HTTP method (always POST for webhooks) */
  method: 'POST';

  /** Optional custom headers to include with webhook requests */
  headers?: Record<string, string>;
}

/**
 * CDP Webhook Subscription Labels
 * Configuration for filtering on-chain events
 */
export interface CDPWebhookLabels {
  /** Smart contract address to monitor (with 0x prefix) */
  contract_address: string;

  /** Event name from the contract ABI (e.g., "Transfer") */
  event_name?: string;

  /** Full event signature (e.g., "Transfer(address,address,uint256)") */
  event_signature?: string;

  /** Network name (defaults to base-mainnet) */
  network?: CDPNetwork;

  /** Filter by transaction source address */
  transaction_from?: string;

  /** Filter by transaction destination address */
  transaction_to?: string;

  /** CDP Project ID (auto-populated by CDP) */
  project?: string;

  /** Additional event parameter filters (e.g., params.from, params.to) */
  [key: `params.${string}`]: string | undefined;
}

/**
 * CDP Webhook Subscription Metadata
 * Returned when creating a subscription
 */
export interface CDPSubscriptionMetadata {
  /** Secret for webhook signature verification */
  secret: string;
}

/**
 * CDP Webhook Subscription
 */
export interface CDPWebhookSubscription {
  /** Unique subscription identifier */
  subscriptionId: string;

  /** Human-readable description */
  description: string;

  /** Event types this subscription listens for */
  eventTypes: CDPEventType[];

  /** Webhook delivery target */
  target: CDPWebhookTarget;

  /** Event filtering labels */
  labels: CDPWebhookLabels;

  /** Whether the subscription is active */
  isEnabled: boolean;

  /** Creation timestamp */
  createdAt: string;

  /** Metadata including the webhook secret */
  metadata?: CDPSubscriptionMetadata;
}

/**
 * Create Subscription Request Payload
 */
export interface CDPCreateSubscriptionRequest {
  /** Human-readable description */
  description: string;

  /** Event types to subscribe to */
  eventTypes?: CDPEventType[];

  /** Webhook delivery target */
  target: CDPWebhookTarget;

  /** Event filtering labels */
  labels: Omit<CDPWebhookLabels, 'project'>;

  /** Whether the subscription is enabled (defaults to true) */
  isEnabled?: boolean;
}

/**
 * Update Subscription Request Payload
 */
export interface CDPUpdateSubscriptionRequest {
  /** Updated description */
  description?: string;

  /** Updated event types */
  eventTypes?: CDPEventType[];

  /** Updated target */
  target?: CDPWebhookTarget;

  /** Updated labels */
  labels?: Partial<Omit<CDPWebhookLabels, 'project'>>;

  /** Updated enabled status */
  isEnabled?: boolean;
}

/**
 * CDP API Response for listing subscriptions
 */
export interface CDPListSubscriptionsResponse {
  subscriptions: CDPWebhookSubscription[];
}

/**
 * Processed on-chain activity event for internal use
 */
export interface ProcessedOnchainActivity {
  /** Internal record ID */
  id: string;

  /** Subscription that triggered the event */
  subscriptionId: string;

  /** Event type */
  eventType: CDPEventType;

  /** Smart contract address */
  contractAddress: string;

  /** Event name */
  eventName: string;

  /** Transaction hash */
  transactionHash: string;

  /** Block number */
  blockNumber: number;

  /** Network */
  network: CDPNetwork;

  /** Raw event data */
  rawData: CDPOnchainActivityData;

  /** Timestamp when processed */
  processedAt: string;
}

/**
 * Known contract addresses for monitoring
 */
export const CDP_MONITORED_CONTRACTS = {
  /** USDC on Base Mainnet */
  USDC_BASE_MAINNET: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',

  /** USDC on Base Sepolia */
  USDC_BASE_SEPOLIA: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',

  /** USD Base Coin */
  USD_BASE_COIN: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
} as const;

/**
 * Common ERC-20 event signatures
 */
export const CDP_EVENT_SIGNATURES = {
  TRANSFER: 'Transfer(address,address,uint256)',
  APPROVAL: 'Approval(address,address,uint256)',
} as const;
