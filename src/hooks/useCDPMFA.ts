/**
 * CDP Multi-Factor Authentication (MFA) Hooks
 * 
 * Centralized exports for Coinbase Developer Platform (CDP) MFA hooks.
 * These hooks provide comprehensive multi-factor authentication functionality
 * for enhanced account security.
 * 
 * MFA Flow:
 * 1. Check if user has MFA configured (useGetMfaConfig)
 * 2. Initiate MFA enrollment (useInitiateMfaEnrollment)
 * 3. Submit enrollment with TOTP code (useSubmitMfaEnrollment)
 * 4. For subsequent logins, initiate verification (useInitiateMfaVerification)
 * 5. Submit verification with TOTP code (useSubmitMfaVerification)
 * 
 * Usage:
 * ```tsx
 * import { 
 *   useGetMfaConfig, 
 *   useInitiateMfaEnrollment, 
 *   useSubmitMfaEnrollment 
 * } from '@/hooks/useCDPMFA';
 * 
 * function MFASetupComponent() {
 *   const { getMfaConfig, mfaConfig } = useGetMfaConfig();
 *   const { initiateMfaEnrollment, qrCode } = useInitiateMfaEnrollment();
 *   const { submitMfaEnrollment } = useSubmitMfaEnrollment();
 *   
 *   const handleEnableMFA = async () => {
 *     // Step 1: Initiate enrollment
 *     const { qrCode, secret } = await initiateMfaEnrollment();
 *     
 *     // Step 2: User scans QR code with authenticator app
 *     // Step 3: User enters TOTP code from app
 *     const code = prompt('Enter code from authenticator app:');
 *     
 *     // Step 4: Submit enrollment
 *     await submitMfaEnrollment({ totpCode: code });
 *   };
 *   
 *   return (
 *     <div>
 *       {!mfaConfig?.enabled ? (
 *         <button onClick={handleEnableMFA}>Enable 2FA</button>
 *       ) : (
 *         <div>2FA is enabled</div>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 * 
 * Security Best Practices:
 * - Always encourage users to enable MFA for sensitive operations
 * - Store backup codes securely
 * - Provide clear instructions for authenticator app setup
 * - Allow users to disable/reset MFA with proper verification
 * - Track MFA enrollment prompts to avoid annoying users
 */

// Re-export CDP MFA hooks for centralized access
export {
  // MFA Configuration
  useGetMfaConfig,
  
  // MFA Enrollment
  useInitiateMfaEnrollment,
  useSubmitMfaEnrollment,
  useRecordMfaEnrollmentPrompted,
  
  // MFA Verification (Login)
  useInitiateMfaVerification,
  useSubmitMfaVerification,
} from '@coinbase/cdp-hooks';

/**
 * Type re-exports for TypeScript support
 */
export type {
  GetMfaConfigResult,
  InitiateMfaOptions,
  InitiateMfaEnrollmentResult,
  SubmitMfaEnrollmentOptions,
  SubmitMfaEnrollmentResult,
  SubmitMfaVerificationOptions,
  RecordMfaEnrollmentPromptedResult,
} from '@coinbase/cdp-hooks';
