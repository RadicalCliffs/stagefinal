/**
 * Complete React Hooks Index
 * 
 * Central export hub for all React hooks in the application.
 * Includes CDP hooks, Base SDK hooks, and custom application hooks.
 * 
 * Categories:
 * - CDP Hooks: @coinbase/cdp-hooks for embedded wallets
 * - Base Hooks: @base-org/account SDK integration
 * - Custom Hooks: Application-specific functionality
 * 
 * Quick Reference:
 * ```tsx
 * // CDP Authentication
 * import { useCurrentUser, useSignInWithEmail, useIsSignedIn } from '@/hooks';
 * 
 * // CDP Wallet Management
 * import { useEvmAccounts, useEvmAddress, useCreateEvmSmartAccount } from '@/hooks';
 * 
 * // CDP Transactions
 * import { useSendEvmTransaction, useSignEvmMessage, useSignEvmTypedData } from '@/hooks';
 * 
 * // CDP Spend Permissions
 * import { useCreateSpendPermission, useListSpendPermissions } from '@/hooks';
 * 
 * // CDP MFA
 * import { useGetMfaConfig, useInitiateMfaEnrollment } from '@/hooks';
 * 
 * // Base SDK (use comprehensive version from useBaseSubAccount.ts)
 * import { useBaseAccountSDK, useBaseProvider, useBaseSession } from '@/hooks';
 * import useBaseSubAccount from '@/hooks/useBaseSubAccount';
 * 
 * // Custom Application Hooks
 * import { useAuthUser, useSpendPermission, useRealTimeBalance } from '@/hooks';
 * ```
 */

// ===================================================================
// CDP Hooks - Coinbase Developer Platform (@coinbase/cdp-hooks)
// ===================================================================

// All CDP hooks from centralized exports
export * from './cdp';

// Or import specific categories:
// export * from './useCDPAuth';
// export * from './useCDPWallet';
// export * from './useCDPTransactions';
// export * from './useCDPSpendPermissions';
// export * from './useCDPMFA';
// export * from './useCDPUtils';

// ===================================================================
// Base SDK Hooks - Base Account SDK (@base-org/account)
// ===================================================================

export * from './useBaseAccount';
export { default as useBaseSubAccount } from './useBaseSubAccount';

// ===================================================================
// Custom Application Hooks
// ===================================================================

// Authentication & User Context
export { useAuthUser, AuthProvider } from '../contexts/AuthContext';

// Spend Permission (Enhanced Custom Implementation)
export { 
  useSpendPermission,
  prepareSpendCallData,
  checkWalletCapabilities,
  executeSpendCalls,
  type SpendPermission,
  type SpendPermissionConfig,
  type UseSpendPermissionResult,
} from './useSpendPermission';

// OnchainKit Configuration
export { useOnchainKitConfig, type OnchainKitConfig } from './useOnchainKitConfig';

// Real-time Data
export { useRealTimeBalance } from './useRealTimeBalance';
export { useRealTimeCompetition } from './useRealTimeCompetition';
export { useRealtimeSubscriptions } from './useRealtimeSubscriptions';
export { useSupabaseRealtime } from './useSupabaseRealtime';

// Competition & Tickets
export { useCompetitions as useFetchCompetitions } from './useFetchCompetitions';
export { useInstantWinTickets } from './useInstantWinTickets';
export { useTicketBroadcast } from './useTicketBroadcast';

// User Profile & Data
export { useUserProfile } from './useUserProfile';
export { useOmnipotentData } from './useOmnipotentData';
export { useAvatar } from './useAvatar';

// Wallet & Tokens
export { useWalletTokens } from './useWalletTokens';

// Form & UI
export { useFormValidation } from './useFormValidation';
export { useToast } from './useToast';
export { useIsMobile } from './useIsMobile';
export { useClickOutside as useHandleClickOutside } from './useHandleClickOutside';

// Dashboard & Reservation
export { useEnhancedDashboard } from './useEnhancedDashboard';
export { useEnhancedReservation } from './useEnhancedReservation';
export { useProactiveReservationMonitor } from './useProactiveReservationMonitor';

// Authentication & Login
export { useCustomLogin } from './useCustomLogin';

// Payments
export { usePaymentStatus as useGetPaymentStatus } from './useGetPaymentStatus';

// Reliability & Connection
export { useConnectionState as useReconnectResilience } from './useReconnectResilience';

// Debug
export { useVRFDebug } from './useVRFDebug';

/**
 * Hook Categories Reference
 * 
 * CDP Authentication:
 * - useCurrentUser, useIsSignedIn, useIsInitialized, useSignOut
 * - useSignInWithEmail, useVerifyEmailOTP
 * - useSignInWithSms, useVerifySmsOTP
 * - useSignInWithOAuth, useLinkApple, useLinkGoogle
 * - useAuthenticateWithJWT, useGetAccessToken
 * 
 * CDP Wallet Management:
 * - useEvmAccounts, useEvmAddress, useEvmSmartAccounts
 * - useSolanaAccounts, useSolanaAddress
 * - useCreateEvmEoaAccount, useCreateEvmSmartAccount, useCreateSolanaAccount
 * - useExportEvmAccount, useExportSolanaAccount
 * 
 * CDP Transactions:
 * - useSendEvmTransaction, useSignEvmTransaction, useSignEvmMessage
 * - useSignEvmHash, useSignEvmTypedData
 * - useSendSolanaTransaction, useSignSolanaTransaction, useSignSolanaMessage
 * - useSendUserOperation, useWaitForUserOperation
 * 
 * CDP Spend Permissions:
 * - useCreateSpendPermission, useListSpendPermissions, useRevokeSpendPermission
 * 
 * CDP MFA:
 * - useGetMfaConfig, useInitiateMfaEnrollment, useSubmitMfaEnrollment
 * - useInitiateMfaVerification, useSubmitMfaVerification
 * 
 * Base SDK:
 * - useBaseAccountSDK, useBaseProvider, useBaseSession
 * - useBaseSubAccount (from useBaseSubAccount.ts - comprehensive with spend permissions)
 * - useBaseAccountSubAccount (from useBaseAccount.ts - basic sub-account creation only)
 * - useBasePayments
 * 
 * Custom Application:
 * - useAuthUser - User authentication state
 * - useSpendPermission - Enhanced spend permission management
 * - useRealTimeBalance - Real-time wallet balance updates
 * - useRealTimeCompetition - Real-time competition updates
 * - useFetchCompetitions - Competition data fetching
 * - useUserProfile - User profile management
 * - useWalletTokens - Wallet token balances
 * - useFormValidation - Form validation utilities
 * - useToast - Toast notification system
 * - useIsMobile - Mobile device detection
 */
