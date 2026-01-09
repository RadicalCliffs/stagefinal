import React, { useEffect, useState, useCallback, useRef } from "react";
import { X, Wallet, CheckCircle, ArrowRight, Shield, Copy, Check, ExternalLink, Smartphone, AlertCircle, Loader2 } from "lucide-react";
import { SignIn, type SignInState } from "@coinbase/cdp-react";
import { useCurrentUser, useEvmAddress, useIsSignedIn, useSignOut } from "@coinbase/cdp-hooks";
import { ConnectWallet, Wallet as WalletComponent, WalletDropdown } from '@coinbase/onchainkit/wallet';
import { Identity, Avatar, Name, Address } from '@coinbase/onchainkit/identity';
import { useAccount, useDisconnect } from 'wagmi';
import { supabase } from "../lib/supabase";
import { userDataService } from "../services/userDataService";
import { toPrizePid } from "../utils/userId";

interface BaseWalletAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Simplified screen flow states - CDP handles email verification
type FlowState = 
  | 'cdp-signin'             // Screen 1: CDP SignIn (handles email + OTP automatically)
  | 'profile-completion'     // Screen 2: Profile setup for first-time users
  | 'wallet-choice'          // Screen 3: Choose wallet type (external wallets)
  | 'logged-in-success';     // Screen 4: Success - You're live

// Profile completion data for first-time users
interface ProfileData {
  username: string;
  fullName: string;
  country: string;
  avatar?: string;
  mobile?: string;
  socialProfiles?: string;
}

/**
 * Validates that a wallet address is not the treasury address
 */
function validateNotTreasuryAddress(walletAddress: string): void {
  const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS?.toLowerCase();
  if (treasuryAddress && walletAddress.toLowerCase() === treasuryAddress) {
    console.error('[BaseWallet] ⚠️  BLOCKED: Attempted to use treasury address as user wallet!');
    throw new Error('Invalid wallet address: Treasury address cannot be used as user wallet');
  }
}

// Check if email exists in database (returning user)
async function checkExistingUser(email: string): Promise<{ 
  exists: boolean; 
  hasWallet: boolean;
  walletAddress?: string;
  hasCompletedProfile: boolean;
}> {
  try {
    const { data } = await supabase
      .from('canonical_users')
      .select('id, email, wallet_address, privy_user_id, username, country')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (data) {
      return { 
        exists: true, 
        hasWallet: !!data.wallet_address,
        walletAddress: data.wallet_address,
        hasCompletedProfile: !!(data.username && data.country)
      };
    }
    return { exists: false, hasWallet: false, hasCompletedProfile: false };
  } catch (error) {
    console.error('[BaseWallet] Error checking existing user:', error);
    return { exists: false, hasWallet: false, hasCompletedProfile: false };
  }
}

// Save wallet-only user to database (for external wallet connections)
async function saveWalletOnlyUser(walletAddress: string, email?: string): Promise<boolean> {
  try {
    console.log('[BaseWallet] Saving wallet-only user to database:', { walletAddress, email });

    // CRITICAL: Validate wallet address is not the treasury address
    validateNotTreasuryAddress(walletAddress);

    // Generate canonical user ID from wallet address
    const canonicalUserId = toPrizePid(walletAddress);
    console.log('[BaseWallet] Generated canonical_user_id:', canonicalUserId);

    // Step 0: Check by EMAIL FIRST if provided
    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      const { data: byEmail } = await supabase
        .from('canonical_users')
        .select('id, wallet_address, canonical_user_id, avatar_url')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (byEmail) {
        console.log('[BaseWallet] Found existing user by email, linking wallet:', byEmail.id);
        await supabase.from('canonical_users').update({
          wallet_address: walletAddress,
          base_wallet_address: walletAddress,
          eth_wallet_address: walletAddress,
          privy_user_id: walletAddress,
          canonical_user_id: canonicalUserId,
          avatar_url: byEmail.avatar_url || userDataService.getDefaultAvatar(),
        }).eq('id', byEmail.id);
        return true;
      }
    }

    // Step 1: Check if user already exists by wallet address or canonical ID
    const { data: byWallet } = await supabase
      .from('canonical_users')
      .select('id, email, wallet_address, base_wallet_address, privy_user_id, canonical_user_id, avatar_url, username')
      .or(`wallet_address.eq.${walletAddress},base_wallet_address.eq.${walletAddress},privy_user_id.eq.${walletAddress},canonical_user_id.eq.${canonicalUserId}`)
      .maybeSingle();

    if (byWallet) {
      console.log('[BaseWallet] Found existing user by wallet:', byWallet.id);
      const updates: Record<string, any> = {};

      if (!byWallet.privy_user_id || byWallet.privy_user_id !== walletAddress) {
        updates.privy_user_id = walletAddress;
      }

      if (!byWallet.canonical_user_id) {
        updates.canonical_user_id = canonicalUserId;
      }

      if (!byWallet.avatar_url) {
        updates.avatar_url = userDataService.getDefaultAvatar();
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from('canonical_users').update(updates).eq('id', byWallet.id);
      }
      return true;
    }

    // Step 2: Create new user with wallet address only
    console.log('[BaseWallet] Creating new wallet-only user with canonical_user_id:', canonicalUserId);
    const { error } = await supabase
      .from('canonical_users')
      .insert({
        canonical_user_id: canonicalUserId,
        wallet_address: walletAddress,
        base_wallet_address: walletAddress,
        eth_wallet_address: walletAddress,
        privy_user_id: walletAddress,
        username: `user_${walletAddress.slice(2, 8)}`,
        avatar_url: userDataService.getDefaultAvatar(),
        usdc_balance: 0,
        has_used_new_user_bonus: false,
        created_at: new Date().toISOString(),
      });

    if (error) {
      if (error.code === '23505') {
        console.warn('[BaseWallet] User already exists (concurrent creation)');
        return true;
      }
      console.error('[BaseWallet] Error creating wallet-only user:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[BaseWallet] Database error:', error);
    return false;
  }
}

// Save user with profile data to database
async function saveUserWithProfile(email: string, walletAddress: string, profile: ProfileData): Promise<boolean> {
  try {
    console.log('[BaseWallet] Saving user with profile to database:', { email, walletAddress, profile });
    const normalizedEmail = email.toLowerCase().trim();

    // CRITICAL: Validate wallet address is not the treasury address
    validateNotTreasuryAddress(walletAddress);

    // Generate canonical user ID from wallet address
    const canonicalUserId = toPrizePid(walletAddress);

    // Check if user already exists by wallet address or canonical ID
    const { data: byWallet } = await supabase
      .from('canonical_users')
      .select('id, email, wallet_address')
      .or(`wallet_address.eq.${walletAddress},base_wallet_address.eq.${walletAddress},privy_user_id.eq.${walletAddress},canonical_user_id.eq.${canonicalUserId}`)
      .maybeSingle();

    if (byWallet) {
      // Update existing user with profile data
      console.log('[BaseWallet] Updating existing user with profile:', byWallet.id);
      const { error } = await supabase
        .from('canonical_users')
        .update({
          email: normalizedEmail,
          username: profile.username,
          first_name: profile.fullName.split(' ')[0],
          last_name: profile.fullName.split(' ').slice(1).join(' '),
          country: profile.country,
          avatar_url: profile.avatar || userDataService.getDefaultAvatar(),
          telephone_number: profile.mobile || null,
          telegram_handle: profile.socialProfiles || null,
          canonical_user_id: canonicalUserId,
          privy_user_id: walletAddress,
        })
        .eq('id', byWallet.id);

      return !error;
    }

    // Check if user exists by email
    const { data: byEmail } = await supabase
      .from('canonical_users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (byEmail) {
      // Link wallet to existing email account with profile
      console.log('[BaseWallet] Linking wallet to existing email account with profile:', byEmail.id);
      const { error } = await supabase
        .from('canonical_users')
        .update({
          wallet_address: walletAddress,
          base_wallet_address: walletAddress,
          eth_wallet_address: walletAddress,
          privy_user_id: walletAddress,
          canonical_user_id: canonicalUserId,
          username: profile.username,
          first_name: profile.fullName.split(' ')[0],
          last_name: profile.fullName.split(' ').slice(1).join(' '),
          country: profile.country,
          avatar_url: profile.avatar || userDataService.getDefaultAvatar(),
          telephone_number: profile.mobile || null,
          telegram_handle: profile.socialProfiles || null,
        })
        .eq('id', byEmail.id);

      return !error;
    }

    // Create new user with profile
    console.log('[BaseWallet] Creating new user with profile and canonical_user_id:', canonicalUserId);
    const { error } = await supabase
      .from('canonical_users')
      .insert({
        canonical_user_id: canonicalUserId,
        email: normalizedEmail,
        wallet_address: walletAddress,
        base_wallet_address: walletAddress,
        eth_wallet_address: walletAddress,
        privy_user_id: walletAddress,
        username: profile.username,
        first_name: profile.fullName.split(' ')[0],
        last_name: profile.fullName.split(' ').slice(1).join(' '),
        country: profile.country,
        avatar_url: profile.avatar || userDataService.getDefaultAvatar(),
        telephone_number: profile.mobile || null,
        telegram_handle: profile.socialProfiles || null,
        usdc_balance: 0,
        has_used_new_user_bonus: false,
        created_at: new Date().toISOString(),
      });

    if (error) {
      if (error.code === '23505') {
        console.warn('[BaseWallet] User already exists (concurrent creation)');
        return true;
      }
      console.error('[BaseWallet] Error creating user with profile:', error);
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
}) => {
  const { currentUser } = useCurrentUser();
  const { isSignedIn: cdpIsSignedIn } = useIsSignedIn();
  const { evmAddress } = useEvmAddress();
  const { signOut } = useSignOut();

  // Wagmi hooks for external wallet connection (Base App, Coinbase Wallet, etc.)
  const { address: wagmiAddress, isConnected: wagmiIsConnected } = useAccount();
  const { disconnect: _wagmiDisconnect } = useDisconnect();

  // Get the effective wallet address (CDP or wagmi)
  const effectiveWalletAddress = evmAddress || wagmiAddress;

  // Simplified state management - CDP handles email verification
  const [flowState, setFlowState] = useState<FlowState>('cdp-signin');
  const [userEmail, setUserEmail] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  
  // Profile completion state
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

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      savedToDbRef.current = false;
      profileCheckedRef.current = false;
      setEmailError('');
      setFlowState('cdp-signin');
      setProfileData({
        username: '',
        fullName: '',
        country: '',
        avatar: '',
        mobile: '',
        socialProfiles: '',
      });
    }
  }, [isOpen]);

  // If already authenticated with Base/CDP, close immediately
  useEffect(() => {
    if (cdpIsSignedIn && evmAddress && isOpen) {
      onClose();
    }
  }, [cdpIsSignedIn, evmAddress, isOpen, onClose]);

  // Handle external wallet connection (wagmi) - save to database and show success
  useEffect(() => {
    const shouldProcessConnection =
      flowState === 'wallet-choice' &&
      wagmiIsConnected &&
      wagmiAddress &&
      !savedToDbRef.current;

    if (shouldProcessConnection) {
      console.log('[BaseWallet] External wallet connected via wagmi:', wagmiAddress);
      savedToDbRef.current = true;

      // Save wallet to database
      saveWalletOnlyUser(wagmiAddress, userEmail).then((success) => {
        if (success) {
          console.log('[BaseWallet] External wallet saved to database');
          localStorage.setItem('cdp:wallet_address', wagmiAddress);
          setFlowState('logged-in-success');
        } else {
          console.error('[BaseWallet] Failed to save external wallet to database');
          setEmailError('Failed to save wallet. Please try again.');
        }
      });
    }
  }, [flowState, wagmiIsConnected, wagmiAddress, userEmail]);

  // Extract email from CDP user and check if profile completion is needed
  useEffect(() => {
    const handleCDPSignInSuccess = async () => {
      if (flowState === 'cdp-signin' && cdpIsSignedIn && evmAddress && currentUser && !profileCheckedRef.current) {
        profileCheckedRef.current = true;
        
        const email = currentUser.email ||
                     (currentUser as any).emails?.[0]?.value ||
                     (currentUser as any).emails?.[0]?.address;
        
        if (email) {
          setUserEmail(email);
          console.log('[BaseWallet] CDP sign-in successful:', { email, wallet: evmAddress });
          
          // Check if user needs profile completion
          const result = await checkExistingUser(email);
          
          if (result.exists && result.hasCompletedProfile) {
            // Existing user with complete profile - save and show success
            if (!savedToDbRef.current) {
              savedToDbRef.current = true;
              await saveWalletOnlyUser(evmAddress, email);
              localStorage.setItem('cdp:wallet_address', evmAddress);
            }
            setFlowState('logged-in-success');
          } else {
            // New user or incomplete profile - go to profile completion
            setFlowState('profile-completion');
          }
        }
      }
    };
    
    void handleCDPSignInSuccess();
  }, [flowState, cdpIsSignedIn, evmAddress, currentUser]);

  // Profile Completion Handler
  const handleCompleteProfile = useCallback(async () => {
    // Validate required fields
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
    
    // Save user with profile data
    if (evmAddress && userEmail && !savedToDbRef.current) {
      savedToDbRef.current = true;
      await saveUserWithProfile(userEmail, evmAddress, profileData);
      localStorage.setItem('cdp:wallet_address', evmAddress);
      setFlowState('logged-in-success');
    }
  }, [profileData, evmAddress, userEmail]);

  // Complete Authentication Handler
  const handleAuthenticate = useCallback(async () => {
    console.log('[BaseWallet] Base auth complete, finalizing...');

    if (!effectiveWalletAddress) {
      console.error('[BaseWallet] Cannot authenticate: No wallet address available');
      setEmailError('Wallet address not available. Please try again.');
      return;
    }

    try {
      validateNotTreasuryAddress(effectiveWalletAddress);
    } catch (error) {
      console.error('[BaseWallet] Treasury address validation failed:', error);
      setEmailError('Invalid wallet configuration detected. Please contact support.');
      return;
    }

    // Store wallet address and dispatch auth-complete event
    localStorage.setItem('cdp:wallet_address', effectiveWalletAddress);
    window.dispatchEvent(new CustomEvent('auth-complete', {
      detail: {
        walletAddress: effectiveWalletAddress,
        email: userEmail
      }
    }));

    await new Promise(resolve => setTimeout(resolve, 100));
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

        {/* === SCREEN 1: CDP SignIn (handles email + OTP automatically) === */}
        {flowState === 'cdp-signin' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-[#0052FF] rounded-full flex items-center justify-center mb-4">
              <Wallet size={32} className="text-white" />
            </div>

            <h2 className="text-white text-2xl font-bold mb-2">Welcome to ThePrize</h2>
            <p className="text-white/60 text-sm mb-6 text-center">
              Sign in or create your account with Base
            </p>

            <div className="w-full">
              <SignIn onSuccess={() => {
                console.log('[BaseWallet] CDP sign-in successful - wallet will be available shortly');
              }}>
                {(state: SignInState) => {
                  if (state.error) {
                    console.log('[BaseWallet] CDP error:', state.error);
                    const errorStr = typeof state.error === 'string' ? state.error : (state.error as any)?.message || '';
                    const errorLower = errorStr.toLowerCase();

                    // Handle specific error cases
                    if (errorLower.includes('already linked') || errorLower.includes('already associated')) {
                      return (
                        <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                          <p className="text-yellow-400 text-xs text-center">
                            This email already has an account. Please enter the verification code sent to your email to sign in.
                          </p>
                        </div>
                      );
                    }

                    if (errorLower.includes('rate limit') || errorLower.includes('too many')) {
                      return (
                        <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                          <p className="text-red-400 text-xs text-center">
                            Too many attempts. Please wait a moment before trying again.
                          </p>
                        </div>
                      );
                    }

                    if (errorLower.includes('network') || errorLower.includes('connection') || errorLower.includes('timeout')) {
                      return (
                        <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                          <p className="text-red-400 text-xs text-center">
                            Network error. Please check your connection and try again.
                          </p>
                        </div>
                      );
                    }

                    if (errorLower.includes('invalid email') || errorLower.includes('email format')) {
                      return (
                        <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                          <p className="text-red-400 text-xs text-center">
                            Please enter a valid email address.
                          </p>
                        </div>
                      );
                    }

                    if (errorLower.includes('cancelled') || errorLower.includes('rejected') || errorLower.includes('denied')) {
                      return null; // Don't show error for user cancellation
                    }

                    // Generic error fallback
                    return (
                      <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-red-400 text-xs text-center">
                          Something went wrong. Please try again.
                        </p>
                      </div>
                    );
                  }
                  // Return null to let SignIn render its default UI
                  return null;
                }}
              </SignIn>
            </div>

            <p className="text-white/40 text-xs mt-4 text-center">
              CDP will handle email verification automatically
            </p>

            <button
              onClick={() => setFlowState('wallet-choice')}
              className="mt-4 text-[#0052FF] text-sm hover:text-[#0052FF]/80"
            >
              Or connect existing wallet →
            </button>
          </div>
        )}

        {/* === SCREEN 2: Profile Completion === */}
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
                <span className="text-red-400 text-xs">{emailError}</span>
              )}
            </div>

            <button
              onClick={handleCompleteProfile}
              disabled={!profileData.username || !profileData.fullName || !profileData.country}
              className="w-full bg-[#0052FF] text-white font-bold py-3 rounded-lg hover:bg-[#0052FF]/90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Continue
            </button>

            <p className="text-white/40 text-xs mt-4 text-center">
              Your email will be saved as your account login.
            </p>
          </div>
        )}

        {/* === SCREEN 3: Wallet Choice === */}
        {flowState === 'wallet-choice' && (
          <div className="flex flex-col">
            <div className="w-16 h-16 bg-[#0052FF] rounded-full flex items-center justify-center mb-4 mx-auto">
              <Wallet size={32} className="text-white" />
            </div>

            <h2 className="text-white text-2xl font-bold mb-2 text-center">Choose how you want to use ThePrize</h2>
            <p className="text-white/60 text-sm mb-6 text-center">
              This wallet will be used to sign in, enter competitions, and receive tickets.
            </p>

            <div className="w-full space-y-3 mb-6">
              {/* Option 1: Use Base App */}
              <div className="bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Smartphone size={20} className="text-[#0052FF]" />
                  <span className="text-white font-semibold">Use my Base App</span>
                  <span className="text-[#DDE404] text-xs font-semibold ml-auto">Recommended</span>
                </div>
                <p className="text-white/60 text-xs mb-3">
                  Fastest option. Connect your Base app to continue.
                </p>
                <WalletComponent>
                  <ConnectWallet className="w-full bg-[#0052FF] hover:bg-[#0052FF]/90 text-white font-bold py-2 rounded-lg">
                    <Avatar className="h-6 w-6" />
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
                
                {!wagmiIsConnected && (
                  <a
                    href="https://www.base.org/wallet"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#0052FF] text-xs mt-2 inline-flex items-center gap-1 hover:underline"
                  >
                    Download Base App <ExternalLink size={12} />
                  </a>
                )}
              </div>

              {/* Option 2: Use Existing Wallet */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Wallet size={20} className="text-white/70" />
                  <span className="text-white font-semibold">Use an existing Base wallet</span>
                </div>
                <p className="text-white/60 text-xs mb-3">
                  Connect another wallet that supports the Base network.
                </p>
                <WalletComponent>
                  <ConnectWallet className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 rounded-lg border border-white/20">
                    <Avatar className="h-6 w-6" />
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
            </div>

            <button
              onClick={() => setFlowState('cdp-signin')}
              className="text-white/40 text-xs hover:text-white/60"
            >
              ← Back to sign in
            </button>
          </div>
        )}

        {/* === SCREEN 4: Logged In Success === */}
        {flowState === 'logged-in-success' && effectiveWalletAddress && (
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-gradient-to-br from-[#0052FF] to-[#DDE404] rounded-full flex items-center justify-center mb-4">
              <CheckCircle size={40} className="text-white" />
            </div>

            <h2 className="text-white text-3xl font-bold mb-2">You're live.</h2>
            <p className="text-white/60 text-base mb-6 text-center">
              The Platform Players Trust.
            </p>
            
            {/* Wallet Address */}
            <div className="w-full bg-[#0052FF]/20 border border-[#0052FF] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/70 text-xs">Your Wallet Address</span>
                <button onClick={handleCopy} className="flex items-center gap-1 text-[#0052FF] text-xs">
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-white text-sm font-mono break-all">{effectiveWalletAddress}</p>
            </div>

            {/* Email */}
            {userEmail && (
              <div className="w-full bg-white/5 border border-white/10 rounded-lg p-3 mb-4">
                <p className="text-white/50 text-xs mb-1">Account Email</p>
                <p className="text-white text-sm">{userEmail}</p>
              </div>
            )}

            <button
              onClick={handleAuthenticate}
              className="w-full bg-[#DDE404] text-black font-bold py-3 rounded-lg hover:bg-[#DDE404]/90 mb-2"
            >
              Start Entering Competitions
            </button>

            <a
              href={`https://${import.meta.env.VITE_BASE_MAINNET === 'true' ? 'basescan.org' : 'sepolia.basescan.org'}/address/${effectiveWalletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-white/30 text-xs mt-3 hover:text-white/50"
            >
              View on BaseScan <ExternalLink size={10} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default BaseWalletAuthModal;
