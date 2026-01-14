/**
 * New Authentication Modal - Compliant with Requirements
 * 
 * This modal implements the exact flow specified:
 * 1. Username entry/creation
 * 2. Profile completion (email OTP, name, country, avatar, social)
 * 3. Wallet connection (Base wallet required)
 * 4. Success confirmation
 * 
 * All user data is stored in canonical_users and profiles tables with canonical_user_id as the primary identifier.
 */

import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, User, Mail, Globe, Wallet as WalletIcon, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toPrizePid } from '../utils/userId';
import { SignIn } from '@coinbase/cdp-react';
import { ConnectWallet } from '@coinbase/onchainkit/wallet';
import { useCurrentUser, useEvmAddress, useIsSignedIn } from '@coinbase/cdp-hooks';

interface NewAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthStep = 
  | 'username'           // Step 1: Enter or create username
  | 'profile'            // Step 2: Complete profile (email OTP, name, country, avatar, social)
  | 'email-otp'          // Step 2a: Email verification with OTP
  | 'wallet'             // Step 3: Connect Base wallet
  | 'success';           // Step 4: Success confirmation

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

  // CDP hooks for wallet connection
  const { currentUser } = useCurrentUser();
  const { evmAddress } = useEvmAddress();
  const { isSignedIn } = useIsSignedIn();

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('username');
      setProfileData({ username: '', email: '' });
      setError(null);
      setOtpCode('');
      setOtpSent(false);
      setIsReturningUser(false);
    }
  }, [isOpen]);

  // Check if wallet is connected, auto-advance to success
  useEffect(() => {
    if (step === 'wallet' && isSignedIn && evmAddress) {
      handleWalletConnected();
    }
  }, [step, isSignedIn, evmAddress]);

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
   * Step 2: Complete profile and send OTP
   */
  const handleProfileSubmit = async () => {
    if (!profileData.email.trim()) {
      setError('Email is required');
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

    setIsLoading(true);
    setError(null);

    try {
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
    if (!evmAddress) {
      setError('No wallet address detected');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Generate canonical_user_id from wallet address
      const canonicalUserId = toPrizePid(evmAddress);

      // Create or update user in canonical_users table
      const { error: upsertError } = await supabase
        .from('canonical_users')
        .upsert({
          canonical_user_id: canonicalUserId,
          username: profileData.username.toLowerCase(),
          email: profileData.email.toLowerCase(),
          wallet_address: evmAddress.toLowerCase(),
          base_wallet_address: evmAddress.toLowerCase(),
          eth_wallet_address: evmAddress.toLowerCase(),
          ...(profileData.country && { country: profileData.country }),
          ...(profileData.avatar && { avatar_url: profileData.avatar }),
          ...(profileData.telegram && { telegram_handle: profileData.telegram }),
        }, {
          onConflict: 'canonical_user_id'
        });

      if (upsertError) throw upsertError;

      // Also upsert to profiles table
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: canonicalUserId,
          wallet_address: evmAddress.toLowerCase(),
        }, {
          onConflict: 'id'
        });

      if (profileError) {
        console.warn('[NewAuthModal] Profile upsert error (non-fatal):', profileError);
      }

      // Initialize sub_account_balances if doesn't exist
      const { error: balanceError } = await supabase
        .from('sub_account_balances')
        .upsert({
          user_id: canonicalUserId,
          currency: 'USD',
          available_balance: 0,
          pending_balance: 0,
        }, {
          onConflict: 'user_id,currency',
          ignoreDuplicates: true
        });

      if (balanceError) {
        console.warn('[NewAuthModal] Balance init error (non-fatal):', balanceError);
      }

      // Success!
      setStep('success');
      
      // Dispatch auth-complete event for AuthContext to refresh
      const event = new CustomEvent('auth-complete', { 
        detail: { 
          walletAddress: evmAddress,
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
    } finally {
      setIsLoading(false);
    }
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
              {!isSignedIn ? (
                <>
                  <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                    <ConnectWallet className="w-full">
                      <button className="w-full py-3 bg-[#0052FF] hover:bg-[#0041CC] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
                        <WalletIcon size={20} />
                        Connect an existing Base wallet
                      </button>
                    </ConnectWallet>
                    <p className="text-xs text-white/50 mt-2">
                      Recommended if you already use Base or Coinbase Wallet.
                    </p>
                  </div>

                  <div className="text-center text-white/40 text-sm">OR</div>

                  <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                    <SignIn />
                    <p className="text-xs text-white/50 mt-2">
                      No wallet yet? Create one now and get started instantly.
                    </p>
                  </div>
                </>
              ) : (
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle size={20} />
                    <span className="font-semibold">Wallet Connected!</span>
                  </div>
                  <p className="text-white/70 text-sm mt-2">
                    {evmAddress?.substring(0, 6)}...{evmAddress?.substring(evmAddress.length - 4)}
                  </p>
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
