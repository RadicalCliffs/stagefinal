/**
 * CDP Authentication Hooks
 * 
 * Centralized exports for Coinbase Developer Platform (CDP) authentication hooks.
 * These hooks handle user authentication via email, SMS, OAuth, and multi-factor authentication.
 * 
 * Usage:
 * ```tsx
 * import { useSignInWithEmail, useSignInWithOAuth, useIsSignedIn } from '@/hooks/useCDPAuth';
 * 
 * function AuthComponent() {
 *   const { signInWithEmail } = useSignInWithEmail();
 *   const { isSignedIn } = useIsSignedIn();
 *   
 *   const handleEmailSignIn = async () => {
 *     await signInWithEmail({ email: 'user@example.com' });
 *   };
 *   
 *   return isSignedIn ? <Dashboard /> : <Login onLogin={handleEmailSignIn} />;
 * }
 * ```
 */

// Re-export CDP authentication hooks for centralized access
export {
  // Core Authentication State
  useCurrentUser,
  useIsSignedIn,
  useIsInitialized,
  useSignOut,
  
  // Email Authentication
  useSignInWithEmail,
  useVerifyEmailOTP,
  
  // SMS Authentication
  useSignInWithSms,
  useVerifySmsOTP,
  
  // OAuth Authentication
  useSignInWithOAuth,
  useOAuthState,
  
  // Account Linking
  useLinkEmail,
  useLinkSms,
  useLinkOAuth,
  useLinkApple,
  useLinkGoogle,
  
  // JWT Authentication
  useAuthenticateWithJWT,
  useGetAccessToken,
  
  // Utility Hooks
  useEnforceAuthenticated,
  useEnforceUnauthenticated,
} from '@coinbase/cdp-hooks';

/**
 * Type re-exports for TypeScript support
 */
export type {
  User,
  SignInWithEmailOptions,
  SignInWithEmailResult,
  SignInWithSmsOptions,
  SignInWithSmsResult,
  VerifyEmailOTPOptions,
  VerifyEmailOTPResult,
  VerifySmsOTPOptions,
  VerifySmsOTPResult,
  OAuth2ProviderType,
  OAuthFlowState,
  AuthenticateWithJWTResult,
} from '@coinbase/cdp-hooks';
