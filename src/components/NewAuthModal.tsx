/**
 * New Authentication Modal - Compliant with Requirements
 *
 * This modal implements the exact flow specified:
 * 1. Username entry/creation
 * 2. Profile completion (email OTP, name, country, avatar, social)
 * 3. Wallet connection (Base wallet required)
 * 4. Success confirmation
 *
 * All user data is stored in canonical_users table with canonical_user_id as the primary identifier.
 * The profiles table is also updated for user-editable profile data (linked by wallet_address).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, User, Mail, Globe, Wallet as WalletIcon, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { setSignupData } from '../utils/signupGuard';

// Constants
const MODAL_TRANSITION_DELAY_MS = 100; // Delay to ensure modal closes before opening new one

// Interface for BaseWalletAuthModal event detail
interface BaseWalletAuthModalOptions {
  resumeSignup: boolean;
  email?: string;
  isReturningUser?: boolean;
  returningUserWalletAddress?: string;
  connectExisting?: boolean; // Signal to show wallet-choice directly (for users who verified email and want existing wallet)
}

// Text overrides for visual editor live preview
export interface NewAuthModalTextOverrides {
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  createAccountTitle?: string;
  createAccountSubtitle?: string;
  successTitle?: string;
  successSubtitle?: string;
  connectWalletTitle?: string;
  connectWalletSubtitle?: string;
}

interface NewAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Optional text overrides for visual editor live preview
  textOverrides?: NewAuthModalTextOverrides;
}

type AuthStep =
  | 'username'           // Step 1: Enter or create username
  | 'profile'            // Step 2: Complete profile (email OTP, name, country, avatar, social)
  | 'email-otp'          // Step 2a: Email verification with OTP
  | 'success'            // Step 4: Success confirmation
  | 'existing-account'   // Step: Show existing account options
  | 'username-recovery'  // Step: Send username reminder email
  | 'disassociate-email';// Step: Confirm email disassociation

interface ProfileData {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  avatar?: string;
  telegram?: string;
  xConnected?: boolean;
  metaConnected?: boolean;
}

interface ExistingAccountInfo {
  type: 'email' | 'username' | 'both';
  existingEmail?: string;
  existingUsername?: string;
  maskedEmail?: string;
}

export default function NewAuthModal({ isOpen, onClose, textOverrides }: NewAuthModalProps) {
  const [step, setStep] = useState<AuthStep>('username');
  const [profileData, setProfileData] = useState<ProfileData>({
    username: '',
    email: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [existingAccountInfo, setExistingAccountInfo] = useState<ExistingAccountInfo | null>(null);
  const [recoveryEmailSent, setRecoveryEmailSent] = useState(false);

  /**
   * Helper function to transition from NewAuthModal to BaseWalletAuthModal
   * Encapsulates the pattern of closing this modal, saving data, and opening BaseWalletAuthModal
   */
  const openBaseWalletAuthModal = useCallback((options: BaseWalletAuthModalOptions) => {
    // Save profile data to localStorage for BaseWalletAuthModal to consume
    // IMPORTANT: Use options.isReturningUser if provided, as it's more reliable than state
    // (React state updates are async, so isReturningUser state may not be updated yet)
    // CRITICAL FIX: For returning users, override profileData.email with options.email
    // because the profileData state may still be empty for returning users
    const effectiveProfileData = {
      ...profileData,
      // For returning users, use the email from options (from database) not from state
      email: options.email || profileData.email,
    };

    // CRITICAL: Store in BOTH localStorage AND sessionStorage for maximum reliability
    // Use the new signupGuard utility for consistent behavior
    const signupDataObj = {
      profileData: effectiveProfileData,
      isReturningUser: options.isReturningUser ?? isReturningUser,
      timestamp: Date.now(),
      ...(options.returningUserWalletAddress && { returningUserWalletAddress: options.returningUserWalletAddress })
    };
    
    setSignupData(signupDataObj);

    // Close this modal
    onClose();

    // Open BaseWalletAuthModal after a small delay to ensure clean transition
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-base-wallet-auth', {
        detail: options
      }));
    }, MODAL_TRANSITION_DELAY_MS);
  }, [profileData, isReturningUser, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('username');
      setProfileData({ username: '', email: '' });
      setError(null);
      setOtpCode('');
      setOtpSent(false);
      setIsReturningUser(false);
      setExistingAccountInfo(null);
      setRecoveryEmailSent(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  /**
   * Step 1: Check if username exists
   */
  const handleUsernameSubmit = async () => {
    if (!profileData.username.trim()) {
      setError('Please enter a username');
      return;
    }

    const username = profileData.username.trim().toLowerCase();

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username can only contain letters, numbers, and underscores');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check if username exists
      const { data, error: queryError } = await supabase
        .from('canonical_users')
        .select('id, username, email, wallet_address, base_wallet_address')
        .ilike('username', username)
        .maybeSingle();

      if (queryError) throw queryError;

      if (data) {
        // Returning user - check if they have a wallet
        setIsReturningUser(true);
        setProfileData(prev => ({ ...prev, email: data.email || '' }));

        if (data.wallet_address || data.base_wallet_address) {
          // Has wallet - open BaseWalletAuthModal for wallet authentication
          const walletAddr = data.wallet_address || data.base_wallet_address || '';

          console.log('[NewAuthModal] Returning user detected, opening wallet connection modal');

          // Open BaseWalletAuthModal for returning user authentication
          // This modal handles the wallet connection and authentication flow
          openBaseWalletAuthModal({
            resumeSignup: true,
            email: data.email || '',
            isReturningUser: true,
            returningUserWalletAddress: walletAddr
          });
        } else {
          // No wallet, need to complete profile first
          setStep('profile');
        }
      } else {
        // New user - go to profile creation
        setIsReturningUser(false);
        setStep('profile');
      }
    } catch (err) {
      console.error('[NewAuthModal] Error checking username:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Helper: Mask email for privacy (e.g., t***@email.com)
   */
  const maskEmail = (email: string): string => {
    const [localPart, domain] = email.split('@');
    if (!domain) return email;
    const masked = localPart.charAt(0) + '***';
    return `${masked}@${domain}`;
  };

  /**
   * Check for existing email or username in database
   */
  const checkForDuplicates = async (username: string, email: string): Promise<ExistingAccountInfo | null> => {
    try {
      // Check for existing email
      const { data: emailData } = await supabase
        .from('canonical_users')
        .select('id, username, email')
        .ilike('email', email.trim())
        .maybeSingle();

      // Check for existing username (only if different from email check result)
      const { data: usernameData } = await supabase
        .from('canonical_users')
        .select('id, username, email')
        .ilike('username', username.trim())
        .maybeSingle();

      // Both email and username exist for different accounts
      if (emailData && usernameData && emailData.id !== usernameData.id) {
        return {
          type: 'both',
          existingEmail: emailData.email ?? undefined,
          existingUsername: usernameData.username ?? undefined,
          maskedEmail: emailData.email ? maskEmail(emailData.email) : undefined
        };
      }

      // Only email exists
      if (emailData) {
        return {
          type: 'email',
          existingEmail: emailData.email ?? undefined,
          existingUsername: emailData.username ?? undefined,
          maskedEmail: emailData.email ? maskEmail(emailData.email) : undefined
        };
      }

      // Only username exists
      if (usernameData) {
        return {
          type: 'username',
          existingUsername: usernameData.username ?? undefined,
          existingEmail: usernameData.email ?? undefined,
          maskedEmail: usernameData.email ? maskEmail(usernameData.email) : undefined
        };
      }

      return null;
    } catch (err) {
      console.error('[NewAuthModal] Error checking duplicates:', err);
      return null;
    }
  };

  /**
   * Step 2: Complete profile and send OTP
   */
  const handleProfileSubmit = async () => {
    if (!profileData.email.trim()) {
      setError('Email is required');
      return;
    }

    if (!profileData.username.trim() && !isReturningUser) {
      setError('Username is required');
      return;
    }

    if (!profileData.country && !isReturningUser) {
      setError('Country is required');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(profileData.email)) {
      setError('Please enter a valid email address');
      return;
    }

    // Validate username format (if not returning user)
    if (!isReturningUser && !/^[a-zA-Z0-9_]+$/.test(profileData.username.trim())) {
      setError('Username can only contain letters, numbers, and underscores');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check for duplicate email or username before proceeding
      if (!isReturningUser) {
        const duplicateInfo = await checkForDuplicates(profileData.username, profileData.email);

        if (duplicateInfo) {
          setExistingAccountInfo(duplicateInfo);
          setStep('existing-account');
          setIsLoading(false);
          return;
        }
      }

      // Send OTP via Netlify function using SendGrid
      console.log('[NewAuthModal] Sending OTP to:', profileData.email);

      const response = await fetch('/api/send-otp-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: profileData.email.toLowerCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification code');
      }

      setOtpSent(true);
      setStep('email-otp');
    } catch (err) {
      console.error('[NewAuthModal] Error sending OTP:', err);
      setError(err instanceof Error ? err.message : 'Failed to send verification code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Step 2a: Verify OTP
   */
  const handleOTPVerify = async () => {
    if (otpCode.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Verify OTP via Netlify function
      console.log('[NewAuthModal] Verifying OTP:', otpCode);

      const response = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: profileData.email.toLowerCase(),
          code: otpCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid verification code');
      }

      // CRITICAL FIX: Create user in canonical_users NOW, before Base wallet connects
      // This prevents race condition where Base creates random username
      // Use upsert_canonical_user RPC function which has SECURITY DEFINER
      // to bypass RLS policies (direct INSERT would fail with anon key)
      console.log('[NewAuthModal] Email verified successfully, creating user record before wallet connection');
      
      if (!isReturningUser) {
        try {
          let tempUid: string;
          let tempCanonicalUserId: string;
          
          // Try to allocate a unique temporary placeholder ID from database (prize:pid:temp<N>)
          // This ensures atomicity and prevents collisions across concurrent signups
          console.log('[NewAuthModal] Attempting to allocate temporary placeholder canonical_user_id');
          
          try {
            const { data: allocResult, error: allocError } = await supabase
              .rpc('allocate_temp_canonical_user') as any;
            
            if (allocError) {
              // Check if error is because function doesn't exist (404 / PGRST202)
              const errorCode = (allocError as any)?.code;
              if (errorCode === 'PGRST202' || errorCode === '42883') {
                console.warn('[NewAuthModal] allocate_temp_canonical_user RPC not found - migration not applied. Using fallback.');
                throw new Error('RPC_NOT_FOUND');
              }
              throw allocError;
            }
            
            if (!allocResult) {
              throw new Error('No result from allocate_temp_canonical_user');
            }
            
            tempUid = allocResult.uid;
            tempCanonicalUserId = allocResult.canonical_user_id;
            
            console.log('[NewAuthModal] Allocated temp user from database:', { uid: tempUid, canonical_user_id: tempCanonicalUserId });
          } catch (allocErr: any) {
            // FALLBACK: Generate temp ID locally if RPC doesn't exist
            if (allocErr?.message === 'RPC_NOT_FOUND' || (allocErr as any)?.code === 'PGRST202') {
              console.warn('[NewAuthModal] ⚠️  Database migration not applied! Using local temp ID generation as fallback.');
              console.warn('[NewAuthModal] ⚠️  Please apply migration: 20260201164500_add_temp_user_placeholder_support.sql');
              
              // Generate fallback temp ID using timestamp + random to avoid collisions
              const timestamp = Date.now();
              const random = Math.floor(Math.random() * 1000000);
              const fallbackTempId = `${timestamp}${random}`;
              
              tempUid = crypto.randomUUID();
              tempCanonicalUserId = `prize:pid:temp${fallbackTempId}`;
              
              console.log('[NewAuthModal] Generated fallback temp user:', { uid: tempUid, canonical_user_id: tempCanonicalUserId });
            } else {
              // Real error - re-throw
              throw allocErr;
            }
          }
          
          // Store in sessionStorage for BaseWalletAuthModal to use when wallet connects
          sessionStorage.setItem('pendingSignupData', JSON.stringify({
            uid: tempUid,
            canonical_user_id: tempCanonicalUserId,
            email: profileData.email.toLowerCase(),
            username: profileData.username.toLowerCase(),
            firstName: profileData.firstName,
            lastName: profileData.lastName,
            telegram: profileData.telegram,
            country: profileData.country,
            timestamp: Date.now(),
          }));
          
          // Create canonical_users record with temporary placeholder
          // Call upsert_canonical_user RPC function (has SECURITY DEFINER to bypass RLS)
          console.log('[NewAuthModal] Creating canonical_users record with temp placeholder');
          
          const { data: rpcResult, error: rpcError } = await supabase
            .rpc('upsert_canonical_user', {
              p_uid: tempUid,
              p_canonical_user_id: tempCanonicalUserId,
              p_email: profileData.email.toLowerCase(),
              p_username: profileData.username.toLowerCase(),
              p_first_name: profileData.firstName || null,
              p_last_name: profileData.lastName || null,
              p_telegram_handle: profileData.telegram || null,
              p_country: profileData.country || null,
            });
          
          if (rpcError) {
            console.error('[NewAuthModal] Failed to create user record:', rpcError);
            throw new Error('Failed to save user data. Please try again.');
          }
          
          console.log('[NewAuthModal] User record created successfully with temp ID:', rpcResult);
        } catch (userCreateErr) {
          console.error('[NewAuthModal] Error creating user record:', userCreateErr);
          setError('Failed to save your profile. Please try again.');
          setIsLoading(false);
          return;
        }
      }

      // OTP verified, open BaseWalletAuthModal directly
      // For new users: go to wallet-choice so they can connect an existing wallet OR create new
      // This avoids asking for email again in CDP SignIn (since we already verified it)
      openBaseWalletAuthModal({
        resumeSignup: true,
        email: profileData.email,
        isReturningUser,
        // Signal that email is already verified - show wallet choice directly
        // This prevents duplicate email entry in CDP SignIn
        connectExisting: !isReturningUser, // For new users, show wallet-choice not cdp-signin
      });
    } catch (err) {
      console.error('[NewAuthModal] Error verifying OTP:', err);
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Send username recovery email to the existing email address
   */
  const handleSendUsernameRecovery = async () => {
    if (!existingAccountInfo?.existingEmail) {
      setError('No email address on file');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/send-username-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: existingAccountInfo.existingEmail.toLowerCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send username reminder');
      }

      setRecoveryEmailSent(true);
    } catch (err) {
      console.error('[NewAuthModal] Error sending username reminder:', err);
      setError(err instanceof Error ? err.message : 'Failed to send email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Disassociate email from old account and allow new account creation
   * This marks the old account as inactive but preserves the data for posterity
   */
  const handleDisassociateEmail = async () => {
    if (!existingAccountInfo?.existingEmail) {
      setError('No existing account found');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Update the old account to remove email and mark as inactive
      const { error: updateError } = await supabase
        .from('canonical_users')
        .update({
          email: null,
          is_active: false,
          deactivated_at: new Date().toISOString(),
          deactivation_reason: 'email_disassociation_user_request'
        })
        .ilike('email', existingAccountInfo.existingEmail);

      if (updateError) throw updateError;

      console.log('[NewAuthModal] Email disassociated from old account:', existingAccountInfo.existingEmail);

      // Clear the existing account info and continue with registration
      setExistingAccountInfo(null);
      setError(null);
      setStep('profile');
    } catch (err) {
      console.error('[NewAuthModal] Error disassociating email:', err);
      setError('Failed to process request. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Go back to login with existing account
   */
  const handleLoginWithExistingAccount = () => {
    // Set the username to the existing one and go to username step
    if (existingAccountInfo?.existingUsername) {
      setProfileData(prev => ({ ...prev, username: existingAccountInfo.existingUsername || '' }));
    }
    setExistingAccountInfo(null);
    setStep('username');
    setError(null);
  };

  const renderStep = () => {
    switch (step) {
      case 'username':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-2">{textOverrides?.welcomeTitle || 'Welcome to The Prize'}</h2>
              <p className="text-white/70">{textOverrides?.welcomeSubtitle || 'Sign in with your username to continue.'}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                Username
              </label>
              <input
                type="text"
                value={profileData.username}
                onChange={(e) => setProfileData(prev => ({ ...prev, username: e.target.value }))}
                onKeyPress={(e) => e.key === 'Enter' && handleUsernameSubmit()}
                placeholder="yourname"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-[#0052FF] transition-colors"
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-400 text-sm">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <button
              onClick={handleUsernameSubmit}
              disabled={isLoading || !profileData.username.trim()}
              className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin flex-shrink-0" size={20} />
                  <span>Checking...</span>
                </>
              ) : (
                <>
                  <span>Continue</span>
                  <ArrowRight size={20} className="flex-shrink-0" />
                </>
              )}
            </button>

            <button
              onClick={() => {
                setIsReturningUser(false);
                setStep('profile');
              }}
              className="w-full text-center text-[#0052FF] hover:text-[#0041CC] text-sm transition-colors"
            >
              Create free account
            </button>

            <p className="text-xs text-white/50 text-center">
              By continuing, you agree to our Terms & Privacy Policy
            </p>
          </div>
        );

      case 'profile':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-2">Create your account</h2>
              <p className="text-white/70">Takes under a minute.</p>
            </div>

            {!isReturningUser && (
              <>
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Username*
                  </label>
                  <input
                    type="text"
                    value={profileData.username}
                    onChange={(e) => setProfileData(prev => ({ ...prev, username: e.target.value }))}
                    placeholder="choose a username"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-[#0052FF] transition-colors"
                    disabled={isLoading}
                  />
                  <p className="text-xs text-white/50 mt-1">
                    This will be your public handle. You can't change it later.
                  </p>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                Email*
              </label>
              <input
                type="email"
                value={profileData.email}
                onChange={(e) => setProfileData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="you@domain.com"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-[#0052FF] transition-colors"
                disabled={isLoading || isReturningUser}
              />
              <p className="text-xs text-white/50 mt-1">
                We'll send a one-time code to verify your email.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-2">
                  First name (optional)
                </label>
                <input
                  type="text"
                  value={profileData.firstName || ''}
                  onChange={(e) => setProfileData(prev => ({ ...prev, firstName: e.target.value }))}
                  placeholder="First name"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-[#0052FF] transition-colors"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-2">
                  Last name (optional)
                </label>
                <input
                  type="text"
                  value={profileData.lastName || ''}
                  onChange={(e) => setProfileData(prev => ({ ...prev, lastName: e.target.value }))}
                  placeholder="Last name"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-[#0052FF] transition-colors"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                Country*
              </label>
              <select
                value={profileData.country || ''}
                onChange={(e) => setProfileData(prev => ({ ...prev, country: e.target.value }))}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#0052FF] transition-colors"
                disabled={isLoading}
              >
                <option value="">Select your country</option>
                <option value="US">United States</option>
                <option value="GB">United Kingdom</option>
                <option value="CA">Canada</option>
                <option value="AU">Australia</option>
                <option value="DE">Germany</option>
                <option value="FR">France</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                Telegram handle (optional)
              </label>
              <input
                type="text"
                value={profileData.telegram || ''}
                onChange={(e) => setProfileData(prev => ({ ...prev, telegram: e.target.value }))}
                placeholder="@yourhandle"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-[#0052FF] transition-colors"
                disabled={isLoading}
              />
              <p className="text-xs text-white/50 mt-1">
                Used for support and community updates.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-400 text-sm">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <button
              onClick={handleProfileSubmit}
              disabled={isLoading || !profileData.email.trim() || (!isReturningUser && !profileData.country)}
              className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin flex-shrink-0" size={20} />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <span>Create account</span>
                  <ArrowRight size={20} className="flex-shrink-0" />
                </>
              )}
            </button>

            <p className="text-xs text-white/50 text-center">
              You can skip optional fields and set them up later.
            </p>
          </div>
        );

      case 'email-otp':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-2">Check your email</h2>
              <p className="text-white/70 break-words">
                Enter the 6-digit code we sent to {profileData.email}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/90 mb-2 text-center">
                Verification code
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyPress={(e) => e.key === 'Enter' && otpCode.length === 6 && handleOTPVerify()}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-center text-2xl tracking-widest placeholder-white/40 focus:outline-none focus:border-[#0052FF] transition-colors"
                disabled={isLoading}
              />
              <p className="text-xs text-white/50 mt-1 text-center">
                Didn't get it? Check spam or wait 30 seconds.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-400 text-sm justify-center">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <button
              onClick={handleOTPVerify}
              disabled={isLoading || otpCode.length !== 6}
              className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin flex-shrink-0" size={20} />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <span>Verify & continue</span>
                  <CheckCircle size={20} className="flex-shrink-0" />
                </>
              )}
            </button>

            <button
              onClick={() => {
                setOtpCode('');
                setError(null);
                handleProfileSubmit();
              }}
              disabled={isLoading}
              className="w-full text-center text-[#0052FF] hover:text-[#0041CC] text-sm transition-colors"
            >
              Resend code
            </button>
          </div>
        );

      case 'success':
        return (
          <div className="space-y-6 text-center py-8">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle size={40} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">{textOverrides?.successTitle || "You're all set!"}</h2>
              <p className="text-white/70">
                {textOverrides?.successSubtitle?.replace('{username}', profileData.username) || `Welcome to The Prize, ${profileData.username}`}
              </p>
            </div>
            <p className="text-sm text-white/50">
              Redirecting you now...
            </p>
          </div>
        );

      case 'existing-account':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} className="text-yellow-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Account already exists</h2>
              <p className="text-white/70 break-words">
                {existingAccountInfo?.type === 'email' && (
                  <>This email is already registered with username <strong className="text-white break-all">{existingAccountInfo.existingUsername}</strong>.</>
                )}
                {existingAccountInfo?.type === 'username' && (
                  <>This username is already taken and registered with email <strong className="text-white break-all">{existingAccountInfo.maskedEmail}</strong>.</>
                )}
                {existingAccountInfo?.type === 'both' && (
                  <>Both this email and username are already in use by different accounts.</>
                )}
              </p>
            </div>

            <div className="space-y-3">
              {/* Option 1: Login with existing account */}
              <button
                onClick={handleLoginWithExistingAccount}
                className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <User size={20} className="flex-shrink-0" />
                <span>Login with existing account</span>
              </button>

              {/* Option 2: Send username reminder email */}
              {existingAccountInfo?.existingEmail && (
                <button
                  onClick={() => setStep('username-recovery')}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <Mail size={20} className="flex-shrink-0" />
                  <span>Forgot your username? Get a reminder</span>
                </button>
              )}

              {/* Option 3: Lost email access - create new account */}
              {existingAccountInfo?.type === 'email' && (
                <button
                  onClick={() => setStep('disassociate-email')}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 text-white/70 font-semibold rounded-lg transition-colors text-sm text-center"
                >
                  Lost access to that email? Create new account
                </button>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-400 text-sm justify-center">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <button
              onClick={() => {
                setExistingAccountInfo(null);
                setStep('profile');
              }}
              className="w-full text-center text-white/50 hover:text-white/70 text-sm transition-colors"
            >
              Go back and try different details
            </button>
          </div>
        );

      case 'username-recovery':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#0052FF]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail size={32} className="text-[#0052FF]" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">
                {recoveryEmailSent ? 'Email sent!' : 'Send username reminder'}
              </h2>
              <p className="text-white/70 break-words">
                {recoveryEmailSent ? (
                  <>We've sent your username to <strong className="text-white break-all">{existingAccountInfo?.maskedEmail}</strong>. Check your inbox.</>
                ) : (
                  <>We'll send your username to <strong className="text-white break-all">{existingAccountInfo?.maskedEmail}</strong>.</>
                )}
              </p>
            </div>

            {!recoveryEmailSent ? (
              <button
                onClick={handleSendUsernameRecovery}
                disabled={isLoading}
                className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin flex-shrink-0" size={20} />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Mail size={20} className="flex-shrink-0" />
                    <span>Send reminder email</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleLoginWithExistingAccount}
                className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <ArrowRight size={20} className="flex-shrink-0" />
                <span>Continue to login</span>
              </button>
            )}

            {error && (
              <div className="flex items-start gap-2 text-red-400 text-sm justify-center">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <button
              onClick={() => {
                setRecoveryEmailSent(false);
                setStep('existing-account');
              }}
              className="w-full text-center text-white/50 hover:text-white/70 text-sm transition-colors"
            >
              Go back
            </button>
          </div>
        );

      case 'disassociate-email':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} className="text-red-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Create new account</h2>
              <p className="text-white/70 break-words">
                If you've lost access to the email <strong className="text-white break-all">{existingAccountInfo?.maskedEmail}</strong>,
                we can remove it from your old account so you can create a new one.
              </p>
            </div>

            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-yellow-400 text-sm text-center">
                <strong>Important:</strong> Your old account will become inactive and you won't be able to access
                any entries or balance associated with it. This action cannot be undone.
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleDisassociateEmail}
                disabled={isLoading}
                className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin flex-shrink-0" size={20} />
                    <span>Processing...</span>
                  </>
                ) : (
                  <span>I understand, create new account</span>
                )}
              </button>

              <button
                onClick={() => setStep('existing-account')}
                className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg transition-colors text-center"
              >
                Cancel, go back
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-400 text-sm justify-center">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#0A0A0F] border border-white/10 rounded-2xl shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>

        <div className="p-8">
          {renderStep()}
        </div>
      </div>
    </div>
  );
}

