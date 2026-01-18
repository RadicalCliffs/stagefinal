import React, { useEffect, useState, useCallback, useRef } from "react";
import { X, Wallet, CheckCircle, ArrowRight, Shield, Copy, Check, ExternalLink, Smartphone, AlertCircle, Loader2 } from "lucide-react";
import { SignIn, type SignInState } from "@coinbase/cdp-react";
import { useCurrentUser, useEvmAddress, useIsSignedIn, useSignOut } from "@coinbase/cdp-hooks";
import { ConnectWallet, Wallet as WalletComponent, WalletDropdown } from '@coinbase/onchainkit/wallet';
import { Identity, Avatar, Name, Address } from '@coinbase/onchainkit/identity';
import { useAccount, useDisconnect, useConnect } from 'wagmi';
import { supabase } from "../lib/supabase";
import { userDataService } from "../services/userDataService";
import { toPrizePid } from "../utils/userId";
import { truncateWalletAddress } from "../utils/util";
import BaseLogo from "../assets/images/Base_lockup_white.png";

/**
 * Base Wallet Authentication Modal
 * 
 * This modal handles wallet connection and authentication using Coinbase CDP.
 * 
 * AUTHENTICATION METHODS SUPPORTED:
 * - Email OTP (current implementation via CDP SignIn component)
 * - External wallet connection (via wagmi - MetaMask, Coinbase Wallet, etc.)
 * 
 * AUTHENTICATION METHODS NOT SUPPORTED:
 * - TOTP/Authenticator apps (Google Authenticator, Authy, etc.)
 *   - Coinbase CDP does not natively support TOTP authentication
 *   - To implement TOTP would require:
 *     1. Setting up custom backend authentication with TOTP support
 *     2. Generating JWTs after TOTP verification
 *     3. Configuring CDP to trust your custom JWT provider
 *     4. See: https://docs.cdp.coinbase.com/embedded-wallets/custom-authentication
 * 
 * ALTERNATIVE AUTHENTICATION OPTIONS:
 * - SMS OTP (available in CDP config via authMethods: ["sms"])
 * - Social OAuth (Google, Apple, X via authMethods: ["oauth:google", "oauth:apple"])
 * 
 * FLOW:
 * 1. CDP sign-in (email OTP) or external wallet connection
 * 2. Link wallet to existing user account (find by email)
 * 3. Show success screen with wallet details
 * 4. Auto-close after 2 seconds and dispatch auth-complete event
 */

// Text overrides for visual editor live preview
export interface BaseWalletAuthModalTextOverrides {
  loginTitle?: string;
  loginSubtitle?: string;
  successTitle?: string;
  successSubtitle?: string;
}

interface BaseWalletAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  options?: {
    resumeSignup?: boolean;
    email?: string;
    connectExisting?: boolean;
    createNew?: boolean;
    isReturningUser?: boolean;
    returningUserWalletAddress?: string;
  };
  // Optional text overrides for visual editor live preview
  textOverrides?: BaseWalletAuthModalTextOverrides;
}

type FlowState = 
  | 'cdp-signin'
  | 'profile-completion'
  | 'wallet-choice'
  | 'logged-in-success';

interface ProfileData {
  username: string;
  fullName: string;
  country: string;
  avatar?: string;
  mobile?: string;
  socialProfiles?: string;
}

// Constants for timing
const AUTO_CLOSE_DELAY_MS = 2000; // 2 seconds before auto-closing success screen
const EVENT_PROCESSING_DELAY_MS = 100; // Small delay to ensure event listeners process before modal closes

function validateNotTreasuryAddress(walletAddress: string): void {
  const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS?.toLowerCase();
  if (treasuryAddress && walletAddress.toLowerCase() === treasuryAddress) {
    throw new Error('Invalid wallet address: Treasury address cannot be used as user wallet');
  }
}

/**
 * Find user by email and update with wallet address.
 * This is the ONLY way BaseWalletAuthModal should update users.
 * Users must be created first via NewAuthModal -> /api/create-user
 */
async function linkWalletToExistingUser(email: string, walletAddress: string): Promise<{ success: boolean; userId?: string }> {
  try {
    console.log('[BaseWallet] Looking up user by email:', email);
    validateNotTreasuryAddress(walletAddress);
    
    const normalizedEmail = email.toLowerCase().trim();
    const canonicalUserId = toPrizePid(walletAddress);
    
    // Find user by email
    const { data: existingUser, error: fetchError } = await supabase
      .from('canonical_users')
      .select('id, username, email, country, first_name, last_name')
      .eq('email', normalizedEmail)
      .maybeSingle();
    
    if (fetchError) {
      console.error('[BaseWallet] Error finding user by email:', fetchError);
      return { success: false };
    }
    
    if (!existingUser) {
      console.log('[BaseWallet] No user found with email:', normalizedEmail);
      return { success: false };
    }
    
    console.log('[BaseWallet] Found user, updating with wallet:', existingUser.id);
    
    // Update user with wallet info
    const { error: updateError } = await supabase
      .from('canonical_users')
      .update({
        canonical_user_id: canonicalUserId,
        wallet_address: walletAddress.toLowerCase(),
        base_wallet_address: walletAddress.toLowerCase(),
        eth_wallet_address: walletAddress.toLowerCase(),
        privy_user_id: walletAddress,
        wallet_linked: true,
        auth_provider: 'cdp',
      })
      .eq('id', existingUser.id);
    
    if (updateError) {
      console.error('[BaseWallet] Error updating user with wallet:', updateError);
      return { success: false };
    }
    
    console.log('[BaseWallet] Successfully linked wallet to user:', existingUser.id);
    return { success: true, userId: existingUser.id };
  } catch (error) {
    console.error('[BaseWallet] Error in linkWalletToExistingUser:', error);
    return { success: false };
  }
}

/**
 * Save user with profile data - ONLY used when profile-completion form is shown
 */
async function saveUserWithProfile(email: string, walletAddress: string, profile: ProfileData): Promise<boolean> {
  try {
    console.log('[BaseWallet] Saving user with profile:', { email, walletAddress, profile });
    const normalizedEmail = email.toLowerCase().trim();
    validateNotTreasuryAddress(walletAddress);
    const canonicalUserId = toPrizePid(walletAddress);

    // Check if user exists by email first
    const { data: existingUser } = await supabase
      .from('canonical_users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      // Update existing user
      const { error } = await supabase
        .from('canonical_users')
        .update({
          wallet_address: walletAddress.toLowerCase(),
          base_wallet_address: walletAddress.toLowerCase(),
          eth_wallet_address: walletAddress.toLowerCase(),
          privy_user_id: walletAddress,
          canonical_user_id: canonicalUserId,
          username: profile.username.toLowerCase(),
          first_name: profile.fullName.split(' ')[0] || null,
          last_name: profile.fullName.split(' ').slice(1).join(' ') || null,
          country: profile.country,
          avatar_url: profile.avatar || userDataService.getDefaultAvatar(),
          telephone_number: profile.mobile || null,
          telegram_handle: profile.socialProfiles || null,
          wallet_linked: true,
          auth_provider: 'cdp',
        })
        .eq('id', existingUser.id);
      return !error;
    }

    // Create new user if not found
    const { error } = await supabase
      .from('canonical_users')
      .insert({
        canonical_user_id: canonicalUserId,
        email: normalizedEmail,
        wallet_address: walletAddress.toLowerCase(),
        base_wallet_address: walletAddress.toLowerCase(),
        eth_wallet_address: walletAddress.toLowerCase(),
        privy_user_id: walletAddress,
        username: profile.username.toLowerCase(),
        first_name: profile.fullName.split(' ')[0] || null,
        last_name: profile.fullName.split(' ').slice(1).join(' ') || null,
        country: profile.country,
        avatar_url: profile.avatar || userDataService.getDefaultAvatar(),
        telephone_number: profile.mobile || null,
        telegram_handle: profile.socialProfiles || null,
        usdc_balance: 0,
        has_used_new_user_bonus: false,
        wallet_linked: true,
        auth_provider: 'cdp',
        created_at: new Date().toISOString(),
      });

    if (error && error.code !== '23505') {
      console.error('[BaseWallet] Error creating user:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[BaseWallet] Database error:', error);
    return false;
  }
}

export const BaseWalletAuthModal: React.FC<BaseWalletAuthModalProps> = ({
  isOpen,
  onClose,
  options,
  textOverrides,
}) => {
  const { currentUser } = useCurrentUser();
  const { isSignedIn: cdpIsSignedIn } = useIsSignedIn();
  const { evmAddress } = useEvmAddress();
  const { signOut } = useSignOut();

  const { address: wagmiAddress, isConnected: wagmiIsConnected } = useAccount();
  const { disconnect: _wagmiDisconnect } = useDisconnect();
  const { connect, connectors, isPending: isConnecting } = useConnect();

  // Get effective wallet address from hooks or localStorage fallback
  // The localStorage fallback ensures the success screen works even if the hook value
  // hasn't propagated yet
  const hookWalletAddress = evmAddress || wagmiAddress;
  const [storedWalletAddress, setStoredWalletAddress] = useState<string | null>(null);

  // Update stored wallet address when it changes
  useEffect(() => {
    if (hookWalletAddress) {
      setStoredWalletAddress(hookWalletAddress);
    }
  }, [hookWalletAddress]);

  // Use hook value first, then fall back to stored value (from localStorage set during auth)
  const effectiveWalletAddress = hookWalletAddress || storedWalletAddress || localStorage.getItem('cdp:wallet_address');

  const [flowState, setFlowState] = useState<FlowState>('cdp-signin');
  const [userEmail, setUserEmail] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');

  const [profileData, setProfileData] = useState<ProfileData>({
    username: '',
    fullName: '',
    country: '',
    avatar: '',
    mobile: '',
    socialProfiles: '',
  });

  const [copied, setCopied] = useState(false);
  const savedToDbRef = useRef(false);
  const profileCheckedRef = useRef(false);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      savedToDbRef.current = false;
      profileCheckedRef.current = false;
      setEmailError('');
      
      // Clear any existing auto-close timer
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
      
      // Set userEmail from options if provided
      if (options?.email) {
        setUserEmail(options.email);
      }
      
      // Determine initial flow state based on options
      if (options?.connectExisting) {
        // User wants to connect an existing wallet - go straight to wallet choice
        setFlowState('wallet-choice');
      } else if (options?.createNew) {
        // User wants to create a new wallet - go to CDP sign-in
        setFlowState('cdp-signin');
      } else {
        // Default to CDP sign-in
        setFlowState('cdp-signin');
      }
      
      setProfileData({
        username: '',
        fullName: '',
        country: '',
        avatar: '',
        mobile: '',
        socialProfiles: '',
      });
    }
    
    // Cleanup timer on unmount
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, [isOpen, options]);

  // Handle CDP sign-in success - create user with wallet or link to existing user
  useEffect(() => {
    const handleCDPSignInSuccess = async () => {
      if (flowState === 'cdp-signin' && cdpIsSignedIn && evmAddress && currentUser && !profileCheckedRef.current) {
        profileCheckedRef.current = true;

        const cdpEmail = currentUser.email ||
                     (currentUser as any).emails?.[0]?.value ||
                     (currentUser as any).emails?.[0]?.address;

        if (cdpEmail) {
          setUserEmail(cdpEmail);
          console.log('[BaseWallet] CDP sign-in successful:', { email: cdpEmail, wallet: evmAddress });

          // Check if we have pending signup data from NewAuthModal
          const pendingDataStr = localStorage.getItem('pendingSignupData');
          let pendingData = null;
          if (pendingDataStr) {
            try {
              pendingData = JSON.parse(pendingDataStr);
              console.log('[BaseWallet] Found pending signup data:', pendingData);
              // Clear it so it's not used again
              localStorage.removeItem('pendingSignupData');
            } catch (e) {
              console.error('[BaseWallet] Failed to parse pending signup data:', e);
            }
          }

          // If we have pending profile data from NewAuthModal, create user with that data
          // This is the CRITICAL step: user creation happens atomically with wallet creation
          if (pendingData?.profileData) {
            console.log('[BaseWallet] Creating user with profile data from NewAuthModal + wallet');
            const formProfileData = pendingData.profileData;

            // CRITICAL: Use the email from the form data (which was verified via OTP in NewAuthModal)
            // rather than the CDP email, to ensure the user account is created with the correct email
            // The form email has already been verified; we trust it
            const userEmail = formProfileData.email || cdpEmail;

            // Create user via edge function with wallet address included
            try {
              const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
              const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

              console.log('[BaseWallet] Calling upsert-user with form data:', {
                username: formProfileData.username,
                email: userEmail,
                firstName: formProfileData.firstName,
                lastName: formProfileData.lastName,
                country: formProfileData.country,
                telegram: formProfileData.telegram,
                walletAddress: evmAddress,
              });

              const upsertResponse = await fetch(`${supabaseUrl}/functions/v1/upsert-user`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseAnonKey}`,
                },
                body: JSON.stringify({
                  username: formProfileData.username,
                  email: userEmail,
                  firstName: formProfileData.firstName,
                  lastName: formProfileData.lastName,
                  country: formProfileData.country,
                  telegram: formProfileData.telegram,
                  avatar: formProfileData.avatar,
                  walletAddress: evmAddress, // CRITICAL: Include wallet address in user creation
                }),
              });

              const responseData = await upsertResponse.json();

              if (!upsertResponse.ok) {
                console.error('[BaseWallet] Failed to create user:', responseData);
                throw new Error(responseData.error || 'Failed to create account. Please try again.');
              }

              console.log('[BaseWallet] User created successfully with wallet linked:', responseData);

              // Mark as saved and proceed to success
              savedToDbRef.current = true;
              localStorage.setItem('cdp:wallet_address', evmAddress);

              // Dispatch auth-complete event for AuthContext to refresh user data
              window.dispatchEvent(new CustomEvent('auth-complete', {
                detail: { walletAddress: evmAddress, email: userEmail }
              }));

              // CRITICAL: Set flow state to success to trigger auto-close and success screen
              setFlowState('logged-in-success');
            } catch (err) {
              console.error('[BaseWallet] Failed to create user:', err);
              setEmailError(err instanceof Error ? err.message : 'Failed to create account');
              // Reset profileCheckedRef to allow retry
              profileCheckedRef.current = false;
            }
          } else {
            // No pending data - this is a direct wallet login or returning user
            // Try to find existing user by email and link wallet
            console.log('[BaseWallet] No pending signup data found, attempting to link wallet to existing user');
            const result = await linkWalletToExistingUser(cdpEmail, evmAddress);

            if (result.success) {
              // User found and wallet linked - show success
              console.log('[BaseWallet] Wallet linked successfully to existing user');
              savedToDbRef.current = true;
              localStorage.setItem('cdp:wallet_address', evmAddress);

              window.dispatchEvent(new CustomEvent('auth-complete', {
                detail: { walletAddress: evmAddress, email: cdpEmail }
              }));

              // CRITICAL: Set flow state to success
              setFlowState('logged-in-success');
            } else {
              // No user found with this email - show profile completion form
              console.log('[BaseWallet] No existing user found, showing profile completion');
              setFlowState('profile-completion');
            }
          }
        } else {
          console.error('[BaseWallet] CDP sign-in succeeded but no email found in currentUser');
          setEmailError('Unable to retrieve email from authentication. Please try again.');
          profileCheckedRef.current = false;
        }
      }
    };

    void handleCDPSignInSuccess();
  }, [flowState, cdpIsSignedIn, evmAddress, currentUser]);

  // Handle external wallet connection (wagmi)
  useEffect(() => {
    const handleWagmiConnection = async () => {
      if (flowState === 'wallet-choice' && wagmiIsConnected && wagmiAddress && !savedToDbRef.current) {
        console.log('[BaseWallet] External wallet connected:', wagmiAddress);
        
        // Check if we have pending signup data from NewAuthModal
        const pendingDataStr = localStorage.getItem('pendingSignupData');
        let pendingData = null;
        if (pendingDataStr) {
          try {
            pendingData = JSON.parse(pendingDataStr);
            // Clear it so it's not used again
            localStorage.removeItem('pendingSignupData');
          } catch (e) {
            console.error('[BaseWallet] Failed to parse pending signup data:', e);
          }
        }

        // If we have pending profile data, create user with wallet
        if (pendingData?.profileData) {
          console.log('[BaseWallet] Creating user with profile data + external wallet');
          const profileData = pendingData.profileData;
          
          try {
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
                walletAddress: wagmiAddress, // Include wallet address
              }),
            });

            if (!upsertResponse.ok) {
              throw new Error('Failed to create account');
            }
            
            savedToDbRef.current = true;
            localStorage.setItem('cdp:wallet_address', wagmiAddress);
            
            window.dispatchEvent(new CustomEvent('auth-complete', {
              detail: { walletAddress: wagmiAddress, email: profileData.email }
            }));
            
            setFlowState('logged-in-success');
          } catch (err) {
            console.error('[BaseWallet] Failed to create user:', err);
            setEmailError('Failed to create account. Please try again.');
          }
        } else if (userEmail) {
          // No pending data but we have email - try to link to existing user
          const result = await linkWalletToExistingUser(userEmail, wagmiAddress);
          
          if (result.success) {
            savedToDbRef.current = true;
            localStorage.setItem('cdp:wallet_address', wagmiAddress);
            
            window.dispatchEvent(new CustomEvent('auth-complete', {
              detail: { walletAddress: wagmiAddress, email: userEmail }
            }));
            
            setFlowState('logged-in-success');
          } else {
            setEmailError('No account found with this email. Please sign up first.');
          }
        } else {
          // No pending data and no email - show success anyway
          savedToDbRef.current = true;
          localStorage.setItem('cdp:wallet_address', wagmiAddress);
          
          window.dispatchEvent(new CustomEvent('auth-complete', {
            detail: { walletAddress: wagmiAddress }
          }));
          
          setFlowState('logged-in-success');
        }
      }
    };

    handleWagmiConnection();
  }, [flowState, wagmiIsConnected, wagmiAddress, userEmail]);

  // Auto-close modal after showing success screen for 2 seconds
  // This effect is critical for ensuring the modal doesn't freeze after successful auth
  useEffect(() => {
    if (flowState === 'logged-in-success') {
      // Store the wallet address at the time of success for the success screen
      // This ensures we have the wallet address even if the hook value changes
      const walletForSuccess = effectiveWalletAddress || localStorage.getItem('cdp:wallet_address');

      console.log('[BaseWallet] Success state reached, wallet:', walletForSuccess, ', scheduling auto-close in 2 seconds');

      // Set a timer to auto-close the modal after 2 seconds
      // This runs regardless of whether we have a wallet address to prevent freezing
      autoCloseTimerRef.current = setTimeout(() => {
        console.log('[BaseWallet] Auto-closing modal after success');
        onClose();
      }, AUTO_CLOSE_DELAY_MS);

      // Cleanup function to clear timer if component unmounts or state changes
      return () => {
        if (autoCloseTimerRef.current) {
          clearTimeout(autoCloseTimerRef.current);
          autoCloseTimerRef.current = null;
        }
      };
    }
  }, [flowState, effectiveWalletAddress, onClose]);

  const handleCompleteProfile = useCallback(async () => {
    if (!profileData.username || !profileData.fullName || !profileData.country) {
      setEmailError('Please complete all required fields.');
      return;
    }

    // Check username uniqueness
    const { data } = await supabase
      .from('canonical_users')
      .select('username')
      .ilike('username', profileData.username)
      .limit(1);

    if (data && data.length > 0) {
      setEmailError('Username already taken. Please choose another.');
      return;
    }

    setEmailError('');
    
    if (evmAddress && userEmail && !savedToDbRef.current) {
      savedToDbRef.current = true;
      const success = await saveUserWithProfile(userEmail, evmAddress, profileData);
      if (success) {
        localStorage.setItem('cdp:wallet_address', evmAddress);
        window.dispatchEvent(new CustomEvent('auth-complete', {
          detail: { walletAddress: evmAddress, email: userEmail }
        }));
        setFlowState('logged-in-success');
      } else {
        setEmailError('Failed to save profile. Please try again.');
        savedToDbRef.current = false;
      }
    }
  }, [profileData, evmAddress, userEmail]);

  const handleAuthenticate = useCallback(async () => {
    if (!effectiveWalletAddress) {
      setEmailError('Wallet address not available.');
      return;
    }

    try {
      validateNotTreasuryAddress(effectiveWalletAddress);
    } catch {
      setEmailError('Invalid wallet configuration.');
      return;
    }

    localStorage.setItem('cdp:wallet_address', effectiveWalletAddress);
    window.dispatchEvent(new CustomEvent('auth-complete', {
      detail: { walletAddress: effectiveWalletAddress, email: userEmail }
    }));

    // Small delay to ensure event listeners have time to process auth-complete event
    await new Promise(resolve => setTimeout(resolve, EVENT_PROCESSING_DELAY_MS));
    onClose();
  }, [onClose, effectiveWalletAddress, userEmail]);

  const handleCopy = useCallback(async () => {
    if (effectiveWalletAddress) {
      try {
        await navigator.clipboard.writeText(effectiveWalletAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('[BaseWallet] Copy failed:', err);
      }
    }
  }, [effectiveWalletAddress]);

  const handleConnectMetaMask = useCallback(() => {
    const metaMaskConnector = connectors.find(
      (c) => c.id === 'metaMaskSDK' || c.id === 'metaMask' || c.name.toLowerCase().includes('metamask')
    );

    if (metaMaskConnector) {
      connect({ connector: metaMaskConnector });
    } else {
      const injectedConnector = connectors.find((c) => c.id === 'injected');
      if (injectedConnector) {
        connect({ connector: injectedConnector });
      } else {
        setEmailError('MetaMask not found. Please install the MetaMask browser extension.');
      }
    }
  }, [connectors, connect]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-[#101010] border border-white/10 rounded-2xl p-6 w-full max-w-md relative max-h-[90vh] overflow-y-auto">
        <button
          className="absolute right-4 top-4 text-white/60 hover:text-white"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {flowState === 'cdp-signin' && (
          <div className="flex flex-col items-center">
            <div className="mb-4">
              <img src={BaseLogo} alt="Base" className="h-10" />
            </div>

            <h2 className="text-white text-2xl font-bold mb-2 text-center">
              {textOverrides?.loginTitle || 'Verify with Base to continue'}
            </h2>
            <p className="text-white/60 text-sm mb-2 text-center">
              {textOverrides?.loginSubtitle || (
                <>
                  Enter your email to verify and create your free Base wallet in one step.
                  <br />
                  (You won't have to do this again if you have your wallet saved on phone or desktop*)
                </>
              )}
            </p>

            <div className="w-full">
              <SignIn onSuccess={() => {
                console.log('[BaseWallet] CDP sign-in successful');
              }}>
                {(state: SignInState) => {
                  if (state.error) {
                    const errorStr = typeof state.error === 'string' ? state.error : (state.error as any)?.message || '';
                    const errorLower = errorStr.toLowerCase();

                    if (errorLower.includes('already linked') || errorLower.includes('already associated')) {
                      return (
                        <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg" role="alert">
                          <p className="text-yellow-400 text-xs text-center">
                            This email already has an account. Please enter the verification code.
                          </p>
                        </div>
                      );
                    }

                    if (errorLower.includes('rate limit') || errorLower.includes('too many')) {
                      return (
                        <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg" role="alert">
                          <p className="text-red-400 text-xs text-center">
                            Too many attempts. Please wait a moment.
                          </p>
                        </div>
                      );
                    }

                    if (errorLower.includes('cancelled') || errorLower.includes('rejected') || errorLower.includes('denied')) {
                      return null;
                    }

                    return (
                      <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg" role="alert">
                        <p className="text-red-400 text-xs text-center">
                          Something went wrong. Please try again.
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              </SignIn>
            </div>

            <button
              onClick={() => setFlowState('wallet-choice')}
              className="mt-4 text-[#0052FF] text-sm hover:text-[#0052FF]/80 text-center"
            >
              (realized you've already got a Base wallet? No problems, click here to connect that instead)
            </button>
          </div>
        )}

        {flowState === 'profile-completion' && (
          <div className="flex flex-col">
            <div className="w-12 h-12 bg-[#0052FF] rounded-full flex items-center justify-center mb-4 mx-auto">
              <Wallet size={24} className="text-white" />
            </div>

            <h2 className="text-white text-2xl font-bold mb-2 text-center">Complete your profile</h2>
            <p className="text-white/60 text-sm mb-6 text-center">
              Set up your account so you're ready to enter competitions.
            </p>

            <div className="w-full space-y-4 mb-4">
              <div>
                <label className="text-white/70 text-sm mb-1 block">Username *</label>
                <input
                  type="text"
                  placeholder="your_username"
                  value={profileData.username}
                  onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
                  className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              <div>
                <label className="text-white/70 text-sm mb-1 block">Full Name *</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={profileData.fullName}
                  onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                  className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              <div>
                <label className="text-white/70 text-sm mb-1 block">Country *</label>
                <select
                  value={profileData.country}
                  onChange={(e) => setProfileData({ ...profileData, country: e.target.value })}
                  className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#0052FF]"
                >
                  <option value="">Select country</option>
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="CA">Canada</option>
                  <option value="AU">Australia</option>
                  <option value="NZ">New Zealand</option>
                  <option value="IE">Ireland</option>
                  <option value="ZA">South Africa</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div>
                <label className="text-white/70 text-sm mb-1 block">Mobile Number (optional)</label>
                <input
                  type="tel"
                  placeholder="+1 234 567 8900"
                  value={profileData.mobile}
                  onChange={(e) => setProfileData({ ...profileData, mobile: e.target.value })}
                  className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              <div>
                <label className="text-white/70 text-sm mb-1 block">Social Profiles (optional)</label>
                <input
                  type="text"
                  placeholder="Twitter/Telegram handle"
                  value={profileData.socialProfiles}
                  onChange={(e) => setProfileData({ ...profileData, socialProfiles: e.target.value })}
                  className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              {emailError && (
                <div className="flex items-start gap-2 text-red-400 text-xs justify-center">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span className="break-words">{emailError}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleCompleteProfile}
              disabled={!profileData.username || !profileData.fullName || !profileData.country}
              className="w-full bg-[#0052FF] text-white font-bold py-3 rounded-lg hover:bg-[#0052FF]/90 disabled:opacity-60 disabled:cursor-not-allowed text-center"
            >
              Continue
            </button>

            <p className="text-white/40 text-xs mt-4 text-center">
              Your email will be saved as your account login.
            </p>
          </div>
        )}

        {flowState === 'wallet-choice' && (
          <div className="flex flex-col">
            <div className="w-16 h-16 bg-[#0052FF] rounded-full flex items-center justify-center mb-4 mx-auto">
              <Wallet size={32} className="text-white" />
            </div>

            <h2 className="text-white text-2xl font-bold mb-2 text-center">
              {options?.isReturningUser ? 'Sign in with your wallet' : 'Connect your wallet'}
            </h2>
            <p className="text-white/60 text-sm mb-6 text-center">
              {options?.isReturningUser
                ? 'Connect your existing Base wallet to sign in to your account.'
                : options?.resumeSignup 
                  ? 'Signup with an existing Base wallet'
                  : 'Connect an existing wallet or create a new one in seconds.'
              }
            </p>

            {/* Display returning user's wallet address if available */}
            {options?.isReturningUser && options?.returningUserWalletAddress && (
              <div className="mb-4 p-4 bg-white/5 border border-white/10 rounded-lg">
                <div className="text-xs text-white/50 mb-1">Expected wallet</div>
                <div className="text-white font-mono text-sm break-all">
                  {truncateWalletAddress(options.returningUserWalletAddress)}
                </div>
                <div className="text-xs text-white/50 mt-2">
                  Connect this wallet to access your account.
                </div>
              </div>
            )}

            <div className="w-full space-y-4 mb-6">
              {/* Primary Button - Connect Existing Wallet (Blue) */}
              {!wagmiIsConnected ? (
                <>
                  <div className="space-y-3">
                    <div className="flex justify-center w-full">
                      <WalletComponent>
                        <ConnectWallet className="w-full bg-[#0052FF] hover:bg-[#0052FF]/90 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2">
                          <Wallet size={20} className="flex-shrink-0" />
                          <span>
                            {options?.isReturningUser 
                              ? 'Sign in with Base wallet'
                              : 'Connect an existing Base wallet'}
                          </span>
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
                    
                    <p className="text-white/60 text-xs text-center">
                      {options?.isReturningUser
                        ? 'Connect your existing wallet to access your account and continue where you left off.'
                        : options?.resumeSignup 
                          ? 'Connect your Base or Coinbase Wallet to get started. Click the button to continue.'
                          : 'If you have a Base or Coinbase Wallet installed, it will be detected automatically. Otherwise, you can create a new wallet with your email below.'
                      }
                    </p>
                  </div>

                  {/* Show create new wallet option only for new users, not returning users */}
                  {!options?.isReturningUser && (
                    <>
                      {/* Divider */}
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-white/10"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-[#0A0A0F] px-2 text-white/50">OR</span>
                        </div>
                      </div>

                      {/* Secondary text */}
                      {options?.resumeSignup && (
                        <p className="text-white/60 text-xs text-center">
                          Decided you would rather a free Base native wallet instead? Click below to create a new wallet. Note: If you create a new wallet but regularly use another wallet, you may need to remember which wallet is associated with your theprize.io account.
                        </p>
                      )}

                      {/* Secondary Button - Create New Wallet (Yellow) */}
                      <button
                        onClick={() => setFlowState('cdp-signin')}
                        className="w-full bg-[#DDE404] hover:bg-[#DDE404]/90 text-black font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2"
                      >
                        <Shield size={20} className="flex-shrink-0" />
                        <span>CREATE A FREE BASE WALLET</span>
                      </button>

                      {!options?.resumeSignup && (
                        <p className="text-white/60 text-xs text-center">
                          No wallet yet? Create one now and get started instantly.
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-center">
                  <div className="flex items-center justify-center gap-2 text-green-400 mb-2">
                    <CheckCircle size={20} className="flex-shrink-0" />
                    <span className="font-semibold">Wallet Connected!</span>
                  </div>
                  <p className="text-white/70 text-sm break-all">
                    {truncateWalletAddress(wagmiAddress)}
                  </p>
                </div>
              )}
            </div>

            {emailError && (
              <div className="flex items-start gap-2 text-red-400 text-xs justify-center mb-4">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{emailError}</span>
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
        )}

        {flowState === 'logged-in-success' && (
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-gradient-to-br from-[#0052FF] to-[#DDE404] rounded-full flex items-center justify-center mb-4">
              <CheckCircle size={40} className="text-white" />
            </div>

            <h2 className="text-white text-3xl font-bold mb-2 text-center">{textOverrides?.successTitle || "You're live."}</h2>
            <p className="text-white/60 text-base mb-6 text-center">
              {textOverrides?.successSubtitle || 'The Platform Players Trust.'}
            </p>

            {effectiveWalletAddress && (
              <div className="w-full bg-[#0052FF]/20 border border-[#0052FF] rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white/70 text-xs">Your Wallet Address</span>
                  <button onClick={handleCopy} className="flex items-center gap-1 text-[#0052FF] text-xs">
                    {copied ? <Check size={12} className="flex-shrink-0" /> : <Copy size={12} className="flex-shrink-0" />}
                    <span>{copied ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
                <p className="text-white text-sm font-mono break-all text-center">{effectiveWalletAddress}</p>
              </div>
            )}

            {userEmail && (
              <div className="w-full bg-white/5 border border-white/10 rounded-lg p-3 mb-4 text-center">
                <p className="text-white/50 text-xs mb-1">Account Email</p>
                <p className="text-white text-sm break-all">{userEmail}</p>
              </div>
            )}

            <button
              onClick={handleAuthenticate}
              className="w-full bg-[#DDE404] text-black font-bold py-3 rounded-lg hover:bg-[#DDE404]/90 mb-2 text-center"
            >
              Start Entering Competitions
            </button>

            <p className="text-white/50 text-xs text-center">
              Redirecting automatically in 2 seconds...
            </p>

            {effectiveWalletAddress && (
              <a
                href={`https://${import.meta.env.VITE_BASE_MAINNET === 'true' ? 'basescan.org' : 'sepolia.basescan.org'}/address/${effectiveWalletAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-white/30 text-xs mt-3 hover:text-white/50"
              >
                View on BaseScan <ExternalLink size={10} className="flex-shrink-0" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BaseWalletAuthModal;
