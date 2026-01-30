/**
 * CDP Hooks Index
 * 
 * Central export hub for all Coinbase Developer Platform (CDP) React hooks.
 * This file provides organized access to all CDP functionality including:
 * - Authentication (email, SMS, OAuth, MFA)
 * - Wallet Management (EVM, Solana, Smart Accounts)
 * - Transactions (signing, sending, user operations)
 * - Spend Permissions (one-click payments)
 * - Utilities (configuration, X402)
 * 
 * Architecture Note:
 * These hooks integrate with CDP Embedded Wallets and Base Account SDK to provide
 * a seamless onchain experience. All user funds are stored in CDP embedded wallets
 * (not server wallets), ensuring users maintain full custody via their email/passkey.
 * 
 * Quick Reference:
 * ```tsx
 * // Authentication
 * import { useCurrentUser, useSignInWithEmail, useSignOut } from '@/hooks/cdp';
 * 
 * // Wallet Management
 * import { useEvmAccounts, useEvmAddress, useEvmSmartAccounts } from '@/hooks/cdp';
 * 
 * // Transactions
 * import { useSendEvmTransaction, useSignEvmMessage } from '@/hooks/cdp';
 * 
 * // Spend Permissions (One-Click Payments)
 * import { useCreateSpendPermission, useListSpendPermissions } from '@/hooks/cdp';
 * 
 * // Multi-Factor Authentication
 * import { useGetMfaConfig, useInitiateMfaEnrollment } from '@/hooks/cdp';
 * ```
 * 
 * @see https://docs.cdp.coinbase.com/embedded-wallets/react-hooks
 * @see https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/@coinbase/cdp-hooks
 */

// Authentication Hooks
export * from './useCDPAuth';

// Wallet Management Hooks
export * from './useCDPWallet';

// Transaction Hooks
export * from './useCDPTransactions';

// Spend Permission Hooks
export * from './useCDPSpendPermissions';

// Multi-Factor Authentication Hooks
export * from './useCDPMFA';

// Utility Hooks
export * from './useCDPUtils';

/**
 * Hook Categories for Quick Reference
 * 
 * Authentication:
 * - useCurrentUser, useIsSignedIn, useIsInitialized, useSignOut
 * - useSignInWithEmail, useVerifyEmailOTP
 * - useSignInWithSms, useVerifySmsOTP
 * - useSignInWithOAuth, useOAuthState
 * - useLinkEmail, useLinkSms, useLinkOAuth, useLinkApple, useLinkGoogle
 * - useAuthenticateWithJWT, useGetAccessToken
 * - useEnforceAuthenticated, useEnforceUnauthenticated
 * 
 * Wallet Management:
 * - useEvmAccounts, useEvmAddress, useEvmSmartAccounts
 * - useSolanaAccounts, useSolanaAddress
 * - useCreateEvmEoaAccount, useCreateEvmSmartAccount, useCreateSolanaAccount
 * - useExportEvmAccount, useExportSolanaAccount
 * - useEvmKeyExportIframe, useSolanaKeyExportIframe
 * 
 * Transactions:
 * - useSendEvmTransaction, useSignEvmTransaction, useSignEvmMessage
 * - useSignEvmHash, useSignEvmTypedData
 * - useSendSolanaTransaction, useSignSolanaTransaction, useSignSolanaMessage
 * - useSendUserOperation, useWaitForUserOperation
 * 
 * Spend Permissions:
 * - useCreateSpendPermission, useListSpendPermissions, useRevokeSpendPermission
 * 
 * Multi-Factor Authentication:
 * - useGetMfaConfig
 * - useInitiateMfaEnrollment, useSubmitMfaEnrollment, useRecordMfaEnrollmentPrompted
 * - useInitiateMfaVerification, useSubmitMfaVerification
 * 
 * Utilities:
 * - useConfig, useX402
 */
