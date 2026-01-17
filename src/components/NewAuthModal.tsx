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
import { toPrizePid } from '../utils/userId';
import { useCurrentUser, useEvmAddress, useIsSignedIn } from '@coinbase/cdp-hooks';
import { useAccount, useDisconnect } from 'wagmi';

interface NewAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthStep =
  | 'username'           // Step 1: Enter or create username
  | 'profile'            // Step 2: Complete profile (email OTP, name, country, avatar, social)
  | 'email-otp'          // Step 2a: Email verification with OTP
  | 'wallet'             // Step 3: Connect Base wallet
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

export default function NewAuthModal({ isOpen, onClose }: NewAuthModalProps) {
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

  // CDP hooks for wallet connection
  const { currentUser } = useCurrentUser();
  const { evmAddress } = useEvmAddress();
  const { isSignedIn } = useIsSignedIn();

  // Wagmi hooks for external wallet connection (Base App, Coinbase Wallet, etc.)
  const { address: wagmiAddress, isConnected: wagmiIsConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();

  // Get the effective wallet address (CDP or wagmi)
  const effectiveWalletAddress = evmAddress || wagmiAddress;

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
      setWalletProcessing(false);
    }
  }, [isOpen]);

  // Track if we're currently processing wallet connection
  const [walletProcessing, setWalletProcessing] = useState(false);

  // Check if wallet is connected, auto-advance to success
  useEffect(() => {
    // Only auto-advance if:
    // 1. We're on the wallet step
    // 2. We have a wallet address
    // 3. User is signed in via CDP or connected via wagmi
    // 4. We're not already processing
    if (step === 'wallet' && effectiveWalletAddress && (isSignedIn || wagmiIsConnected) && !walletProcessing && !isLoading) {
      console.log('[NewAuthModal] Wallet connected, auto-advancing to handleWalletConnected');
      setWalletProcessing(true);
      handleWalletConnected();
    }
  }, [step, isSignedIn, evmAddress, wagmiIsConnected, wagmiAddress, effectiveWalletAddress, walletProcessing, isLoading]);

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
          // Has wallet, go directly to wallet connection
          setStep('wallet');
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
          existingEmail: emailData.email,
          existingUsername: usernameData.username,
          maskedEmail: maskEmail(emailData.email)
        };
      }

      // Only email exists
      if (emailData) {
        return {
          type: 'email',
          existingEmail: emailData.email,
          existingUsername: emailData.username,
          maskedEmail: maskEmail(emailData.email)
        };
      }

      // Only username exists
      if (usernameData) {
        return {
          type: 'username',
          existingUsername: usernameData.username,
          existingEmail: usernameData.email,
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

      // Create user via edge function with service role access
      if (!isReturningUser) {
        console.log('[NewAuthModal] Creating user via edge function...');
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        
        const upsertResponse = await fetch(`${supabaseUrl}/functions/v1/upsert-user`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            username: profileData.username,
            email: profileData.email,
            firstName: profileData.firstName,
            lastName: profileData.lastName,
            country: profileData.country,
            telegram: profileData.telegram,
            avatar: profileData.avatar,
          }),
        });

        if (!upsertResponse.ok) {
          const errorData = await upsertResponse.json();
          console.error('[NewAuthModal] Failed to create user:', errorData);
          throw new Error('Failed to create account. Please try again.');
        }
        console.log('[NewAuthModal] User created/updated in database');
      }

      // OTP verified, proceed to wallet connection
      setStep('wallet');
    } catch (err) {
      console.error('[NewAuthModal] Error verifying OTP:', err);
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Step 3: Handle wallet connected
   */
  const handleWalletConnected = async () => {
    if (!effectiveWalletAddress) {
      setError('No wallet address detected');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Generate canonical_user_id from wallet address
      const canonicalUserId = toPrizePid(effectiveWalletAddress);

      // First, try to find existing user by email (created during OTP verification)
      const { data: existingUser, error: fetchError } = await supabase
        .from('canonical_users')
        .select('id')
        .eq('email', profileData.email.toLowerCase())
        .maybeSingle();

      if (fetchError) {
        console.warn('[NewAuthModal] Error checking for existing user:', fetchError);
      }

      let canonicalUserUUID: string | undefined;

      if (existingUser) {
        // User exists - update with wallet info
        console.log('[NewAuthModal] Found existing user by email, linking wallet:', existingUser.id);
        const { data: updatedUser, error: updateError } = await supabase
          .from('canonical_users')
          .update({
            canonical_user_id: canonicalUserId,
            wallet_address: effectiveWalletAddress.toLowerCase(),
            base_wallet_address: effectiveWalletAddress.toLowerCase(),
            eth_wallet_address: effectiveWalletAddress.toLowerCase(),
            privy_user_id: effectiveWalletAddress,
          })
          .eq('id', existingUser.id)
          .select('id')
          .single();

        if (updateError) throw updateError;
        canonicalUserUUID = updatedUser?.id;
      } else {
        // No existing user - create new (fallback for edge cases like returning users)
        console.log('[NewAuthModal] No existing user found, creating new user with wallet');
        const { data: canonicalUserData, error: upsertError } = await supabase
          .from('canonical_users')
          .upsert({
            canonical_user_id: canonicalUserId,
            username: profileData.username.toLowerCase(),
            email: profileData.email.toLowerCase(),
            wallet_address: effectiveWalletAddress.toLowerCase(),
            base_wallet_address: effectiveWalletAddress.toLowerCase(),
            eth_wallet_address: effectiveWalletAddress.toLowerCase(),
            privy_user_id: effectiveWalletAddress,
            ...(profileData.firstName && { first_name: profileData.firstName }),
            ...(profileData.lastName && { last_name: profileData.lastName }),
            ...(profileData.country && { country: profileData.country }),
            ...(profileData.avatar && { avatar_url: profileData.avatar }),
            ...(profileData.telegram && { telegram_handle: profileData.telegram }),
          }, {
            onConflict: 'canonical_user_id'
          })
          .select('id')
          .single();

        if (upsertError) throw upsertError;
        canonicalUserUUID = canonicalUserData?.id;
      }

      // Create or update the user's profile in the profiles table
      // The profiles table has a user_id column that references canonical_users.id
      if (canonicalUserUUID) {
        const normalizedWallet = effectiveWalletAddress.toLowerCase();

        // Check if profile already exists by user_id
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', canonicalUserUUID)
          .maybeSingle();

        // Use existing profile id or generate a new UUID
        const profileId = existingProfile?.id || crypto.randomUUID();

        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: profileId,
            user_id: canonicalUserUUID,
            wallet_address: normalizedWallet,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'id'
          });

        if (profileError) {
          console.warn('[NewAuthModal] Profile upsert error (non-fatal):', profileError);
        }
      }

      // Initialize sub_account_balances if doesn't exist
      // Try insert with ignoreDuplicates to avoid constraint issues
      const { error: balanceError } = await supabase
        .from('sub_account_balances')
        .insert({
          user_id: canonicalUserId,
          currency: 'USD',
          available_balance: 0,
          pending_balance: 0,
        });

      // Ignore "duplicate key" errors (23505) as they just mean the balance already exists
      if (balanceError && balanceError.code !== '23505') {
        console.warn('[NewAuthModal] Balance init error (non-fatal):', balanceError);
      }

      // Store wallet address in localStorage for auth flow
      localStorage.setItem('cdp:wallet_address', effectiveWalletAddress);

      // Success!
      setStep('success');

      // Dispatch auth-complete event for AuthContext to refresh
      const event = new CustomEvent('auth-complete', {
        detail: {
          walletAddress: effectiveWalletAddress,
          canonicalUserId
        } 
      });
      window.dispatchEvent(event);

      // Auto-close after 2 seconds
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error('[NewAuthModal] Error saving user data:', err);
      setError('Failed to save your information. Please try again.');
      setWalletProcessing(false); // Reset so user can retry
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
              <h2 className="text-2xl font-bold text-white mb-2">Welcome to The Prize</h2>
              <p className="text-white/70">Sign in with your username to continue.</p>
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

      case 'wallet':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-2">Connect your wallet</h2>
              <p className="text-white/70">
                {isReturningUser 
                  ? 'Login with your existing Base wallet'
                  : 'Connect an existing wallet or create a new one in seconds.'
                }
              </p>
            </div>

            <div className="space-y-4">
              {!isSignedIn && !wagmiIsConnected ? (
                <>
                  {/* Primary button - Connect existing wallet (Blue) */}
                  <button
                    onClick={() => {
                      // Save current profile data to localStorage before opening wallet auth
                      localStorage.setItem('pendingSignupData', JSON.stringify({
                        profileData,
                        isReturningUser,
                        timestamp: Date.now(),
                        connectExisting: true // Flag to indicate user wants to connect existing wallet
                      }));
                      console.log('[NewAuthModal] Opening wallet connector for existing wallet');
                      // Close this modal and dispatch event to open Base wallet auth modal
                      onClose();
                      // Small delay to ensure modal closes before opening new one
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('open-base-wallet-auth', {
                          detail: { 
                            resumeSignup: true, 
                            email: profileData.email,
                            connectExisting: true // Tell BaseWalletAuthModal to skip email and go straight to wallet choice
                          }
                        }));
                      }, 100);
                    }}
                    className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <WalletIcon size={20} className="flex-shrink-0" />
                    <span>Connect an existing Base wallet</span>
                  </button>

                  {/* Helper text for returning users */}
                  {isReturningUser ? (
                    <p className="text-white/60 text-xs text-center">
                      Welcome back to theprize.io
                    </p>
                  ) : (
                    <p className="text-white/60 text-xs text-center">
                      If you have MetaMask, Coinbase Wallet, Base, or another supported wallet installed, it will be detected automatically. Otherwise, you can create a new wallet with your email below.
                    </p>
                  )}

                  {/* Divider */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-[#0A0A0F] px-2 text-white/50">OR</span>
                    </div>
                  </div>

                  {/* Secondary text for returning users */}
                  {isReturningUser && (
                    <p className="text-white/60 text-xs text-center">
                      Don't have access to that account anymore? Click below to create a new wallet:
                    </p>
                  )}

                  {/* Secondary button - Create new wallet (Yellow) */}
                  <button
                    onClick={() => {
                      // Save current profile data to localStorage before opening wallet auth
                      localStorage.setItem('pendingSignupData', JSON.stringify({
                        profileData,
                        isReturningUser,
                        timestamp: Date.now(),
                        createNew: true // Flag to indicate user wants to create new wallet
                      }));
                      console.log('[NewAuthModal] Opening CDP flow to create new wallet');
                      // Close this modal and dispatch event to open Base wallet auth modal
                      onClose();
                      // Small delay to ensure modal closes before opening new one
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('open-base-wallet-auth', {
                          detail: { 
                            resumeSignup: true, 
                            email: profileData.email,
                            createNew: true // Tell BaseWalletAuthModal to go to CDP email flow
                          }
                        }));
                      }, 100);
                    }}
                    className="w-full py-3 bg-[#DDE404] hover:bg-[#DDE404]/90 text-black font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <WalletIcon size={20} className="flex-shrink-0" />
                    <span>Create a free Base wallet</span>
                  </button>

                  {/* Additional info for new users */}
                  {!isReturningUser && (
                    <p className="text-white/60 text-xs text-center">
                      No wallet yet? Create one now and get started instantly.
                    </p>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-center">
                    <div className="flex items-center justify-center gap-2 text-green-400">
                      <CheckCircle size={20} className="flex-shrink-0" />
                      <span className="font-semibold">Wallet Connected!</span>
                    </div>
                    <p className="text-white/70 text-sm mt-2 break-all">
                      {effectiveWalletAddress?.substring(0, 6)}...{effectiveWalletAddress?.substring(effectiveWalletAddress.length - 4)}
                    </p>
                  </div>

                  {/* Manual continue button if auto-advance doesn't trigger */}
                  <button
                    onClick={() => {
                      setWalletProcessing(true);
                      handleWalletConnected();
                    }}
                    disabled={isLoading || walletProcessing}
                    className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isLoading || walletProcessing ? (
                      <>
                        <Loader2 className="animate-spin flex-shrink-0" size={20} />
                        <span>Completing sign up...</span>
                      </>
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight size={20} className="flex-shrink-0" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-400 text-sm justify-center">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <div className="p-4 bg-white/5 rounded-lg text-center space-y-2">
              <p className="text-xs text-white/50">Powered by Coinbase</p>
              <p className="text-xs text-white/40">
                Secure wallet infrastructure and payments powered by Coinbase.
              </p>
              <p className="text-xs text-white/40">
                We never store your private keys. Your wallet is used for entries, top-ups, and ownership verification.
              </p>
            </div>
          </div>
        );

      case 'success':
        return (
          <div className="space-y-6 text-center py-8">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle size={40} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">You're all set!</h2>
              <p className="text-white/70">
                Welcome to The Prize, {profileData.username}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
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

