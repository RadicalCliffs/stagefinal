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

interface BaseWalletAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
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
}) => {
  const { currentUser } = useCurrentUser();
  const { isSignedIn: cdpIsSignedIn } = useIsSignedIn();
  const { evmAddress } = useEvmAddress();
  const { signOut } = useSignOut();

  const { address: wagmiAddress, isConnected: wagmiIsConnected } = useAccount();
  const { disconnect: _wagmiDisconnect } = useDisconnect();
  const { connect, connectors, isPending: isConnecting } = useConnect();

  const effectiveWalletAddress = evmAddress || wagmiAddress;

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

  // Handle CDP sign-in success - find user by email and link wallet
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

          // Try to find existing user by email and link wallet
          const result = await linkWalletToExistingUser(email, evmAddress);
          
          if (result.success) {
            // User found and wallet linked - show success
            console.log('[BaseWallet] Wallet linked successfully');
            savedToDbRef.current = true;
            localStorage.setItem('cdp:wallet_address', evmAddress);
            
            window.dispatchEvent(new CustomEvent('auth-complete', {
              detail: { walletAddress: evmAddress, email }
            }));
            
            setFlowState('logged-in-success');
          } else {
            // No user found with this email - show profile completion
            console.log('[BaseWallet] No existing user found, showing profile completion');
            setFlowState('profile-completion');
          }
        }
      }
    };

    void handleCDPSignInSuccess();
  }, [flowState, cdpIsSignedIn, evmAddress, currentUser]);

  // Handle external wallet connection (wagmi)
  useEffect(() => {
    const handleWagmiConnection = async () => {
      if (flowState === 'wallet-choice' && wagmiIsConnected && wagmiAddress && !savedToDbRef.current && userEmail) {
        console.log('[BaseWallet] External wallet connected:', wagmiAddress);
        
        const result = await linkWalletToExistingUser(userEmail, wagmiAddress);
        
        if (result.success) {
          savedToDbRef.current = true;
          localStorage.setItem('cdp:wallet_address', wagmiAddress);
          setFlowState('logged-in-success');
        } else {
          setEmailError('No account found with this email. Please sign up first.');
        }
      }
    };

    handleWagmiConnection();
  }, [flowState, wagmiIsConnected, wagmiAddress, userEmail]);

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
            <div className="w-16 h-16 bg-[#0052FF] rounded-full flex items-center justify-center mb-4">
              <Wallet size={32} className="text-white" />
            </div>

            <h2 className="text-white text-2xl font-bold mb-2 text-center">Log in or create an account</h2>
            <p className="text-white/60 text-sm mb-6 text-center">
              Enter your email address to continue.
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

            <p className="text-white/40 text-xs mt-4 text-center">
              We'll send you a one-time code to verify your email.
            </p>

            <button
              onClick={() => setFlowState('wallet-choice')}
              className="mt-4 text-[#0052FF] text-sm hover:text-[#0052FF]/80 text-center"
            >
              Or connect existing wallet →
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

            <h2 className="text-white text-2xl font-bold mb-2 text-center">Choose how you want to use ThePrize</h2>
            <p className="text-white/60 text-sm mb-6 text-center">
              This wallet will be used to sign in, enter competitions, and receive tickets.
            </p>

            <div className="w-full space-y-3 mb-6">
              <div className="bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
                  <Smartphone size={20} className="text-[#0052FF] flex-shrink-0" />
                  <span className="text-white font-semibold">Use my Base App</span>
                  <span className="text-[#DDE404] text-xs font-semibold">Recommended</span>
                </div>
                <p className="text-white/60 text-xs mb-3 text-center">
                  Fastest option. Connect your Base app to continue.
                </p>
                <div className="flex justify-center w-full">
                  <WalletComponent>
                    <ConnectWallet className="w-full bg-[#0052FF] hover:bg-[#0052FF]/90 text-white font-bold py-2 px-6 rounded-lg flex items-center justify-center">
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

                {!wagmiIsConnected && (
                  <a
                    href="https://www.base.org/wallet"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#0052FF] text-xs mt-2 flex items-center justify-center gap-1 hover:underline"
                  >
                    Download Base App <ExternalLink size={12} />
                  </a>
                )}
              </div>

              {!wagmiIsConnected && (
                <div className="bg-[#F6851B]/10 border border-[#F6851B]/30 rounded-lg p-4">
                  <div className="flex items-center justify-center gap-3 mb-2">
                    <Wallet size={20} className="text-[#F6851B] flex-shrink-0" />
                    <span className="text-white font-semibold">Connect MetaMask</span>
                  </div>
                  <p className="text-white/60 text-xs mb-3 text-center">
                    Use your existing MetaMask browser wallet.
                  </p>
                  <div className="flex justify-center w-full">
                    <button
                      onClick={handleConnectMetaMask}
                      disabled={isConnecting}
                      className="w-full bg-[#F6851B] hover:bg-[#F6851B]/90 text-white font-bold py-2 px-6 rounded-lg text-center disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        'Connect MetaMask'
                      )}
                    </button>
                  </div>
                </div>
              )}

              {!wagmiIsConnected && (
                <div className="bg-[#DDE404]/10 border border-[#DDE404]/30 rounded-lg p-4">
                  <div className="flex items-center justify-center gap-3 mb-2">
                    <Shield size={20} className="text-[#DDE404] flex-shrink-0" />
                    <span className="text-white font-semibold">Create a free Prize wallet</span>
                  </div>
                  <p className="text-white/60 text-xs mb-3 text-center">
                    No Base wallet found. We'll create one for you automatically.
                  </p>
                  <div className="flex justify-center w-full">
                    <button
                      onClick={() => setFlowState('cdp-signin')}
                      className="w-full bg-[#DDE404] hover:bg-[#DDE404]/90 text-black font-bold py-2 px-6 rounded-lg text-center"
                    >
                      Create wallet
                    </button>
                  </div>
                </div>
              )}
            </div>

            {emailError && (
              <div className="flex items-start gap-2 text-red-400 text-xs justify-center mb-4">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{emailError}</span>
              </div>
            )}

            <button
              onClick={() => setFlowState('cdp-signin')}
              className="text-white/40 text-xs hover:text-white/60 text-center"
            >
              ← Back to sign in
            </button>
          </div>
        )}

        {flowState === 'logged-in-success' && effectiveWalletAddress && (
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-gradient-to-br from-[#0052FF] to-[#DDE404] rounded-full flex items-center justify-center mb-4">
              <CheckCircle size={40} className="text-white" />
            </div>

            <h2 className="text-white text-3xl font-bold mb-2 text-center">You're live.</h2>
            <p className="text-white/60 text-base mb-6 text-center">
              The Platform Players Trust.
            </p>

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

            <a
              href={`https://${import.meta.env.VITE_BASE_MAINNET === 'true' ? 'basescan.org' : 'sepolia.basescan.org'}/address/${effectiveWalletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 text-white/30 text-xs mt-3 hover:text-white/50"
            >
              View on BaseScan <ExternalLink size={10} className="flex-shrink-0" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default BaseWalletAuthModal;
