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
import { X, CheckCircle, AlertCircle, Loader2, User, Mail, Globe, Wallet as WalletIcon, ArrowRight, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toPrizePid } from '../utils/userId';
import { SignIn } from '@coinbase/cdp-react';
import { ConnectWallet, Wallet as WalletComponent, WalletDropdown } from '@coinbase/onchainkit/wallet';
import { Identity, Avatar, Name, Address } from '@coinbase/onchainkit/identity';
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

      // Create or update user in canonical_users table and get the returned data
      const { data: canonicalUserData, error: upsertError } = await supabase
        .from('canonical_users')
        .upsert({
          canonical_user_id: canonicalUserId,
          username: profileData.username.toLowerCase(),
          email: profileData.email.toLowerCase(),
          wallet_address: effectiveWalletAddress.toLowerCase(),
          base_wallet_address: effectiveWalletAddress.toLowerCase(),
          eth_wallet_address: effectiveWalletAddress.toLowerCase(),
          ...(profileData.country && { country: profileData.country }),
          ...(profileData.avatar && { avatar_url: profileData.avatar }),
          ...(profileData.telegram && { telegram_handle: profileData.telegram }),
        }, {
          onConflict: 'canonical_user_id'
        })
        .select('id')
        .single();

      if (upsertError) throw upsertError;

      // Get the canonical_users.id (UUID) for the profiles table foreign key
      const canonicalUserUUID = canonicalUserData?.id;

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
            <div>
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
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <button
              onClick={handleUsernameSubmit}
              disabled={isLoading || !profileData.username.trim()}
              className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Checking...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight size={20} />
                </>
              )}
            </button>

            <button
              onClick={() => {
                setIsReturningUser(false);
                setStep('profile');
              }}
              className="w-full text-[#0052FF] hover:text-[#0041CC] text-sm transition-colors"
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
            <div>
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

            <div className="grid grid-cols-2 gap-4">
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
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <button
              onClick={handleProfileSubmit}
              disabled={isLoading || !profileData.email.trim() || (!isReturningUser && !profileData.country)}
              className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Processing...
                </>
              ) : (
                <>
                  Create account
                  <ArrowRight size={20} />
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
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Check your email</h2>
              <p className="text-white/70">
                Enter the 6-digit code we sent to {profileData.email}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
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
              <p className="text-xs text-white/50 mt-1">
                Didn't get it? Check spam or wait 30 seconds.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <button
              onClick={handleOTPVerify}
              disabled={isLoading || otpCode.length !== 6}
              className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Verifying...
                </>
              ) : (
                <>
                  Verify & continue
                  <CheckCircle size={20} />
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
              className="w-full text-[#0052FF] hover:text-[#0041CC] text-sm transition-colors"
            >
              Resend code
            </button>
          </div>
        );

      case 'wallet':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Connect your wallet</h2>
              <p className="text-white/70">
                Use an existing Base wallet, or create one in seconds.
              </p>
            </div>

            <div className="space-y-4">
              {!isSignedIn && !wagmiIsConnected ? (
                <>
                  {/* Option 1: Connect existing Base wallet via wagmi */}
                  <div className="p-4 bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg">
                    <div className="flex items-center gap-3 mb-2">
                      <WalletIcon size={20} className="text-[#0052FF]" />
                      <span className="text-white font-semibold">Connect existing Base wallet</span>
                      <span className="text-[#DDE404] text-xs font-semibold ml-auto">Recommended</span>
                    </div>
                    <p className="text-white/60 text-xs mb-3">
                      Fastest option if you already use Base or Coinbase Wallet.
                    </p>
                    <WalletComponent>
                      <ConnectWallet
                        className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <Avatar className="h-5 w-5" />
                        <Name />
                      </ConnectWallet>
                      <WalletDropdown>
                        <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
                          <Avatar />
                          <Name />
                          <Address />
                        </Identity>
                      </WalletDropdown>
                    </WalletComponent>
                  </div>

                  <div className="text-center text-white/40 text-sm">OR</div>

                  {/* Option 2: Create new wallet via CDP SignIn */}
                  <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                    <div className="flex items-center gap-3 mb-2">
                      <KeyRound size={20} className="text-white/70" />
                      <span className="text-white font-semibold">Create a new Base wallet</span>
                    </div>
                    <p className="text-white/60 text-xs mb-3">
                      No wallet yet? Create one now and get started instantly.
                    </p>
                    <SignIn />
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <div className="flex items-center gap-2 text-green-400">
                      <CheckCircle size={20} />
                      <span className="font-semibold">Wallet Connected!</span>
                    </div>
                    <p className="text-white/70 text-sm mt-2">
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
                        <Loader2 className="animate-spin" size={20} />
                        Completing sign up...
                      </>
                    ) : (
                      <>
                        Continue
                        <ArrowRight size={20} />
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div className="p-4 bg-white/5 rounded-lg">
              <p className="text-xs text-white/50 mb-2">Powered by Coinbase</p>
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
            <div>
              <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} className="text-yellow-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 text-center">Account already exists</h2>
              <p className="text-white/70 text-center">
                {existingAccountInfo?.type === 'email' && (
                  <>This email is already registered with username <strong className="text-white">{existingAccountInfo.existingUsername}</strong>.</>
                )}
                {existingAccountInfo?.type === 'username' && (
                  <>This username is already taken and registered with email <strong className="text-white">{existingAccountInfo.maskedEmail}</strong>.</>
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
                <User size={20} />
                Login with existing account
              </button>

              {/* Option 2: Send username reminder email */}
              {existingAccountInfo?.existingEmail && (
                <button
                  onClick={() => setStep('username-recovery')}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Mail size={20} />
                  Forgot your username? Get a reminder
                </button>
              )}

              {/* Option 3: Lost email access - create new account */}
              {existingAccountInfo?.type === 'email' && (
                <button
                  onClick={() => setStep('disassociate-email')}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 text-white/70 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  Lost access to that email? Create new account
                </button>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <button
              onClick={() => {
                setExistingAccountInfo(null);
                setStep('profile');
              }}
              className="w-full text-white/50 hover:text-white/70 text-sm transition-colors"
            >
              Go back and try different details
            </button>
          </div>
        );

      case 'username-recovery':
        return (
          <div className="space-y-6">
            <div>
              <div className="w-16 h-16 bg-[#0052FF]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail size={32} className="text-[#0052FF]" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 text-center">
                {recoveryEmailSent ? 'Email sent!' : 'Send username reminder'}
              </h2>
              <p className="text-white/70 text-center">
                {recoveryEmailSent ? (
                  <>We've sent your username to <strong className="text-white">{existingAccountInfo?.maskedEmail}</strong>. Check your inbox.</>
                ) : (
                  <>We'll send your username to <strong className="text-white">{existingAccountInfo?.maskedEmail}</strong>.</>
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
                    <Loader2 className="animate-spin" size={20} />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail size={20} />
                    Send reminder email
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleLoginWithExistingAccount}
                className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <ArrowRight size={20} />
                Continue to login
              </button>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <button
              onClick={() => {
                setRecoveryEmailSent(false);
                setStep('existing-account');
              }}
              className="w-full text-white/50 hover:text-white/70 text-sm transition-colors"
            >
              Go back
            </button>
          </div>
        );

      case 'disassociate-email':
        return (
          <div className="space-y-6">
            <div>
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} className="text-red-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 text-center">Create new account</h2>
              <p className="text-white/70 text-center">
                If you've lost access to the email <strong className="text-white">{existingAccountInfo?.maskedEmail}</strong>,
                we can remove it from your old account so you can create a new one.
              </p>
            </div>

            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-yellow-400 text-sm">
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
                    <Loader2 className="animate-spin" size={20} />
                    Processing...
                  </>
                ) : (
                  <>
                    I understand, create new account
                  </>
                )}
              </button>

              <button
                onClick={() => setStep('existing-account')}
                className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg transition-colors"
              >
                Cancel, go back
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
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
