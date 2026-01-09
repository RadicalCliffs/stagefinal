import React, { useEffect, useState, useCallback, useRef } from "react";
import { X, Wallet, CheckCircle, ArrowRight, Shield, Copy, Check, ExternalLink, Smartphone, AlertCircle, Loader2 } from "lucide-react";
import { SignIn, type SignInState } from "@coinbase/cdp-react";
import { useCurrentUser, useEvmAddress, useIsSignedIn, useSignOut } from "@coinbase/cdp-hooks";
import { ConnectWallet, Wallet as WalletComponent, WalletDropdown } from '@coinbase/onchainkit/wallet';
import { Identity, Avatar, Name, Address } from '@coinbase/onchainkit/identity';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { supabase } from "../lib/supabase";
import { userDataService } from "../services/userDataService";
import { toPrizePid } from "../utils/userId";

interface BaseWalletAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Screen flow states aligned to the specification
type FlowState = 
  | 'login-signup'           // Screen 1: Email entry
  | 'email-verification'     // Screen 2: OTP verification
  | 'returning-user-wallet'  // Screen 3A: Returning user with available wallet
  | 'wallet-unavailable'     // Screen 3B: Returning user with unavailable wallet
  | 'profile-completion'     // Screen 4: Profile setup for first-time users
  | 'wallet-detection'       // Screen 5: Checking for wallets
  | 'wallet-choice'          // Screen 6: Choose wallet type
  | 'network-enforcement'    // Screen 7: Wrong network (handled by EnsureBaseChain)
  | 'signature-confirm'      // Screen 8: Sign message to confirm
  | 'logged-in-success';     // Screen 9: Success - You're live

/**
 * Validates that a wallet address is not the treasury address
 * @param walletAddress - The wallet address to validate
 * @throws Error if the wallet address matches the treasury address
 */
function validateNotTreasuryAddress(walletAddress: string): void {
  const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS?.toLowerCase();
  if (treasuryAddress && walletAddress.toLowerCase() === treasuryAddress) {
    console.error('[BaseWallet] ⚠️  BLOCKED: Attempted to use treasury address as user wallet!');
    console.error('[BaseWallet] Treasury:', treasuryAddress);
    console.error('[BaseWallet] Attempted wallet:', walletAddress);
    throw new Error('Invalid wallet address: Treasury address cannot be used as user wallet');
  }
}

// Profile completion data for first-time users
interface ProfileData {
  username: string;
  fullName: string;
  country: string;
  avatar?: string;
  mobile?: string;
  socialProfiles?: string;
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
// Used when user connects with Base App or other external wallet
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
      // User exists with this wallet - ensure privy_user_id, canonical_user_id, and avatar are set
      console.log('[BaseWallet] Found existing user by wallet:', byWallet.id);
      const updates: Record<string, any> = {};

      if (!byWallet.privy_user_id || byWallet.privy_user_id !== walletAddress) {
        updates.privy_user_id = walletAddress;
      }

      // CRITICAL: Set canonical_user_id if missing
      if (!byWallet.canonical_user_id) {
        updates.canonical_user_id = canonicalUserId;
        console.log('[BaseWallet] Setting missing canonical_user_id for existing user');
      }

      // Assign default avatar if missing
      if (!byWallet.avatar_url) {
        updates.avatar_url = userDataService.getDefaultAvatar();
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('canonical_users')
          .update(updates)
          .eq('id', byWallet.id);
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

// Save user to database immediately after CDP wallet creation
// CRITICAL: This function handles account linking to prevent duplicate accounts
// It checks for existing accounts by email, wallet address, or privy_user_id
// and properly links/updates them rather than creating duplicates
async function saveUserToDatabase(email: string, walletAddress: string): Promise<boolean> {
  try {
    console.log('[BaseWallet] Saving user to database:', { email, walletAddress });
    const normalizedEmail = email.toLowerCase().trim();

    // CRITICAL: Validate wallet address is not the treasury address
    validateNotTreasuryAddress(walletAddress);

    // Generate canonical user ID from wallet address
    const canonicalUserId = toPrizePid(walletAddress);
    console.log('[BaseWallet] Generated canonical_user_id:', canonicalUserId);

    // Step 1: Check if user already exists by wallet address or canonical ID (primary identifier for Base auth)
    const { data: byWallet } = await supabase
      .from('canonical_users')
      .select('id, email, wallet_address, base_wallet_address, privy_user_id, canonical_user_id, avatar_url')
      .or(`wallet_address.eq.${walletAddress},base_wallet_address.eq.${walletAddress},privy_user_id.eq.${walletAddress},canonical_user_id.eq.${canonicalUserId}`)
      .maybeSingle();

    if (byWallet) {
      // User exists with this wallet - update email, canonical_user_id, and avatar if needed
      console.log('[BaseWallet] Found existing user by wallet:', byWallet.id);
      const updates: Record<string, any> = {};

      if (!byWallet.email && normalizedEmail) {
        updates.email = normalizedEmail;
      }
      // Ensure privy_user_id is set to wallet address for Base auth
      if (!byWallet.privy_user_id || byWallet.privy_user_id !== walletAddress) {
        updates.privy_user_id = walletAddress;
      }
      // CRITICAL: Set canonical_user_id if missing
      if (!byWallet.canonical_user_id) {
        updates.canonical_user_id = canonicalUserId;
        console.log('[BaseWallet] Setting missing canonical_user_id for existing user');
      }
      // Assign default avatar if missing
      if (!byWallet.avatar_url) {
        updates.avatar_url = userDataService.getDefaultAvatar();
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('canonical_users')
          .update(updates)
          .eq('id', byWallet.id);
      }
      return true;
    }

    // Step 2: Check if user exists by email (for account linking)
    const { data: byEmail } = await supabase
      .from('canonical_users')
      .select('id, email, wallet_address, base_wallet_address, privy_user_id, canonical_user_id, avatar_url')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (byEmail) {
      // User exists with this email - link the wallet to their account
      console.log('[BaseWallet] Found existing user by email, linking wallet:', byEmail.id);
      const updates: Record<string, any> = {
        wallet_address: walletAddress,
        base_wallet_address: walletAddress,
        eth_wallet_address: walletAddress,
        // Set privy_user_id to wallet address for Base auth (replaces old Privy DID)
        privy_user_id: walletAddress,
        // CRITICAL: Set canonical_user_id when linking wallet to email account
        canonical_user_id: canonicalUserId,
      };

      // Assign default avatar if missing
      if (!byEmail.avatar_url) {
        updates.avatar_url = userDataService.getDefaultAvatar();
      }

      console.log('[BaseWallet] Linking wallet with canonical_user_id:', canonicalUserId);
      await supabase
        .from('canonical_users')
        .update(updates)
        .eq('id', byEmail.id);
      return true;
    }

    // Step 3: Create new user (no existing account found)
    console.log('[BaseWallet] Creating new user with canonical_user_id:', canonicalUserId);
    const { error } = await supabase
      .from('canonical_users')
      .insert({
        canonical_user_id: canonicalUserId,
        email: normalizedEmail,
        wallet_address: walletAddress,
        base_wallet_address: walletAddress,
        eth_wallet_address: walletAddress,
        // CRITICAL: Set privy_user_id to wallet address for Base auth
        // This prevents conflicts with the UNIQUE constraint
        privy_user_id: walletAddress,
        username: normalizedEmail.split('@')[0],
        avatar_url: userDataService.getDefaultAvatar(),
        usdc_balance: 0,
        has_used_new_user_bonus: false,
        created_at: new Date().toISOString(),
      });

    if (error) {
      // Handle unique constraint violation - another request may have created the user
      if (error.code === '23505') {
        console.warn('[BaseWallet] User already exists (concurrent creation), attempting update');
        // Try to update instead - include canonical_user_id
        const { error: updateError } = await supabase
          .from('canonical_users')
          .update({
            wallet_address: walletAddress,
            base_wallet_address: walletAddress,
            eth_wallet_address: walletAddress,
            privy_user_id: walletAddress,
            canonical_user_id: canonicalUserId,
          })
          .eq('email', normalizedEmail);

        if (updateError) {
          console.error('[BaseWallet] Error updating user after conflict:', updateError);
          return false;
        }
        return true;
      }

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

  // Wagmi hooks for external wallet connection (Base App, Coinbase Wallet, etc.)
  const { address: wagmiAddress, isConnected: wagmiIsConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();

  // Get the effective wallet address (CDP or wagmi)
  const effectiveWalletAddress = evmAddress || wagmiAddress;

  // State management for the new flow
  const [flowState, setFlowState] = useState<FlowState>('login-signup');
  const [userEmail, setUserEmail] = useState<string>('');
  const [emailInput, setEmailInput] = useState<string>('');
  const [otpCode, setOtpCode] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  const [otpError, setOtpError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [otpSessionId, setOtpSessionId] = useState<string>('');
  
  // Profile completion state
  const [profileData, setProfileData] = useState<ProfileData>({
    username: '',
    fullName: '',
    country: '',
    avatar: '',
    mobile: '',
    socialProfiles: '',
  });
  
  // Returning user state
  const [returningUserWalletAddress, setReturningUserWalletAddress] = useState<string>('');
  const [hasBaseWallet, setHasBaseWallet] = useState<boolean>(false);
  
  const [copied, setCopied] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const savedToDbRef = useRef(false);
  const walletDetectedRef = useRef(false);
  const sessionClearedRef = useRef(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      // Reset refs but keep flow state if user has a cached CDP session
      savedToDbRef.current = false;
      walletDetectedRef.current = false;
      setIsClearing(false);
      setExternalWalletSaved(false);
      setEmailInput('');
      setEmailError('');
      setIsCheckingEmail(false);
      setExistingUserEmail('');
    } else {
      // Reset session cleared ref when modal closes so next open can clear if needed
      sessionClearedRef.current = false;
    }
  }, [isOpen]);

  // Handle external wallet connection (wagmi) - save to database and show success
  useEffect(() => {
    const shouldProcessConnection =
      flowState === 'connect-wallet' &&
      wagmiIsConnected &&
      wagmiAddress &&
      !externalWalletSaved;

    if (shouldProcessConnection) {
      console.log('[BaseWallet] External wallet connected via wagmi:', wagmiAddress);
      setExternalWalletSaved(true);

      // Save wallet to database
      saveWalletOnlyUser(wagmiAddress, userEmail).then((success) => {
        if (success) {
          console.log('[BaseWallet] External wallet saved to database');
          // Store wallet address in localStorage for AuthContext
          localStorage.setItem('cdp:wallet_address', wagmiAddress);
          setFlowState('success');
        } else {
          console.error('[BaseWallet] Failed to save external wallet to database');
        }
      });
    }
  }, [flowState, wagmiIsConnected, wagmiAddress, externalWalletSaved, userEmail]);

  // Clear stale CDP session when entering sign-in flow to prevent "email already linked" errors
  // This handles the case where a user has a partial/stale session from a previous attempt
  const clearStaleSession = useCallback(async () => {
    if (sessionClearedRef.current) return;
    sessionClearedRef.current = true;

    // Only clear if user is in a partial state (signed in but no wallet)
    // This prevents the "email already linked" error that occurs when
    // a previous sign-in attempt left a stale session
    const hasIncompleteSession = cdpIsSignedIn && !evmAddress;

    if (hasIncompleteSession) {
      console.log('[BaseWallet] Detected incomplete session, clearing before sign-in');
      setIsClearing(true);

      try {
        // Sign out to clear the partial session
        try {
          await signOut();
        } catch (error) {
          console.warn('[BaseWallet] signOut error (may be expected):', error);
        }

        // Clear any CDP-related localStorage items that might contain stale state
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.includes('cdp') || key.includes('coinbase'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => {
          console.log('[BaseWallet] Removing localStorage key:', key);
          localStorage.removeItem(key);
        });

        // Clear sessionStorage as well
        const sessionKeysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && (key.includes('cdp') || key.includes('coinbase'))) {
            sessionKeysToRemove.push(key);
          }
        }
        sessionKeysToRemove.forEach(key => {
          console.log('[BaseWallet] Removing sessionStorage key:', key);
          sessionStorage.removeItem(key);
        });

        // Clear IndexedDB databases that might contain CDP session data
        if (typeof indexedDB !== 'undefined') {
          const databases = await indexedDB.databases?.() || [];
          for (const db of databases) {
            if (db.name && (db.name.includes('cdp') || db.name.includes('coinbase'))) {
              console.log('[BaseWallet] Deleting IndexedDB:', db.name);
              try {
                await new Promise<void>((resolve, reject) => {
                  const req = indexedDB.deleteDatabase(db.name!);
                  req.onsuccess = () => resolve();
                  req.onerror = () => reject(req.error);
                  req.onblocked = () => {
                    console.warn('[BaseWallet] IndexedDB delete blocked:', db.name);
                    resolve();
                  };
                });
              } catch (e) {
                console.warn('[BaseWallet] Error deleting IndexedDB:', db.name, e);
              }
            }
          }
        }

        // Small delay to ensure all cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.warn('[BaseWallet] Error during session cleanup:', error);
      }

      setIsClearing(false);
    }
  }, [cdpIsSignedIn, evmAddress, signOut]);

  // Extract email from CDP user - no longer checking for returning user to redirect to Privy
  useEffect(() => {
    const handleUserEmail = async () => {
      if (currentUser && flowState === 'creating') {
        const email = currentUser.email ||
                     (currentUser as any).emails?.[0]?.value ||
                     (currentUser as any).emails?.[0]?.address;
        if (email && email !== userEmail) {
          setUserEmail(email);
        }
      }
    };

    void handleUserEmail();
  }, [currentUser, flowState, userEmail]);

  // Detect wallet creation and save to DB
  useEffect(() => {
    // Log current state for debugging
    if (flowState === 'creating') {
      console.log('[BaseWallet] Wallet detection check:', {
        cdpIsSignedIn,
        evmAddress: evmAddress || 'not available',
        userEmail: userEmail || 'not available',
        walletDetectedRef: walletDetectedRef.current
      });
    }

    if (flowState === 'creating' && cdpIsSignedIn && evmAddress && userEmail && !walletDetectedRef.current) {
      console.log('[BaseWallet] Wallet created:', { email: userEmail, wallet: evmAddress });
      walletDetectedRef.current = true;

      // Save to database
      if (!savedToDbRef.current) {
        savedToDbRef.current = true;
        saveUserToDatabase(userEmail, evmAddress).then(() => {
          setFlowState('success');
        });
      }
    }
  }, [flowState, cdpIsSignedIn, evmAddress, userEmail]);

  // If already authenticated with Base/CDP, close immediately without showing the modal
  useEffect(() => {
    if (cdpIsSignedIn && evmAddress && isOpen) {
      onClose();
    }
  }, [cdpIsSignedIn, evmAddress, isOpen, onClose]);

  // Check for returning user with cached CDP session
  useEffect(() => {
    if ((flowState === 'email-first' || flowState === 'intro') && cdpIsSignedIn && evmAddress && currentUser) {
      // User has cached CDP wallet - show success state
      const email = currentUser.email ||
                   (currentUser as any).emails?.[0]?.value ||
                   (currentUser as any).emails?.[0]?.address;
      if (email) {
        setUserEmail(email);
        setFlowState('success');
      }
    }
  }, [flowState, cdpIsSignedIn, evmAddress, currentUser]);

  // Handler for email-first flow - check if email exists before showing options
  const handleEmailCheck = useCallback(async () => {
    const email = emailInput.trim().toLowerCase();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailError('Please enter a valid email address.');
      return;
    }

    setEmailError('');
    setIsCheckingEmail(true);

    try {
      const result = await checkExistingUser(email);

      if (result.exists) {
        // Existing user - route to sign-in flow
        setExistingUserEmail(email);
        setUserEmail(email);
        console.log('[BaseWallet] Existing user found, routing to sign-in');
        // Clear any stale session before showing sign-in
        await clearStaleSession();
        setFlowState('creating');
      } else {
        // New user - show account creation options
        setUserEmail(email);
        setFlowState('intro');
      }
    } catch (error) {
      console.error('[BaseWallet] Error checking email:', error);
      setEmailError('Something went wrong. Please try again.');
    } finally {
      setIsCheckingEmail(false);
    }
  }, [emailInput, clearStaleSession]);

  const handleCopy = useCallback(async () => {
    const addressToCopy = evmAddress || wagmiAddress;
    if (addressToCopy) {
      try {
        await navigator.clipboard.writeText(addressToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        // Fallback for Safari/older browsers where clipboard API may fail
        console.warn('[BaseWallet] Clipboard API failed, trying fallback:', err);
        try {
          const textArea = document.createElement('textarea');
          textArea.value = addressToCopy;
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (fallbackErr) {
          console.error('[BaseWallet] Copy failed:', fallbackErr);
        }
      }
    }
  }, [evmAddress, wagmiAddress]);

  // Handle CDP SignIn success - wait for wallet address to become available
  // The CDP SDK triggers onSuccess when OTP is verified, but evmAddress may not
  // be immediately available. This handler polls for it and transitions to success.
  const handleSignInSuccess = useCallback(async () => {
    console.log('[BaseWallet] CDP SignIn success callback triggered');

    // If we already have the wallet address, process immediately
    if (evmAddress && currentUser) {
      const email = currentUser.email ||
                   (currentUser as any).emails?.[0]?.value ||
                   (currentUser as any).emails?.[0]?.address;
      console.log('[BaseWallet] Wallet already available:', { email, wallet: evmAddress });
      if (email) {
        setUserEmail(email);
        if (!savedToDbRef.current) {
          savedToDbRef.current = true;
          walletDetectedRef.current = true;
          await saveUserToDatabase(email, evmAddress);
        }
        setFlowState('success');
      }
      return;
    }

    // If wallet not yet available, wait for it (CDP SDK may be finalizing)
    // Poll for up to 10 seconds with 500ms intervals
    console.log('[BaseWallet] Waiting for wallet address to become available...');
    let attempts = 0;
    const maxAttempts = 20;

    const checkWalletInterval = setInterval(async () => {
      attempts++;
      console.log('[BaseWallet] Checking for wallet address, attempt:', attempts);

      // Note: We need to check the current values from the hooks
      // Since this is in a callback, we rely on the useEffect to handle the transition
      // once evmAddress becomes available. This is mainly for logging/debugging.

      if (attempts >= maxAttempts) {
        console.warn('[BaseWallet] Wallet address not available after timeout');
        clearInterval(checkWalletInterval);
      }
    }, 500);

    // Clean up interval after maxAttempts
    setTimeout(() => clearInterval(checkWalletInterval), maxAttempts * 500 + 100);
  }, [evmAddress, currentUser]);

  // Complete authentication with Base - ensure wallet is stored and close modal
  const handleAuthenticate = useCallback(async () => {
    console.log('[BaseWallet] Base auth complete, finalizing...');

    // CRITICAL: Validate wallet address before proceeding
    if (!effectiveWalletAddress) {
      console.error('[BaseWallet] Cannot authenticate: No wallet address available');
      setEmailError('Wallet address not available. Please try again.');
      return;
    }

    // CRITICAL: Prevent treasury address from being used as user wallet
    try {
      validateNotTreasuryAddress(effectiveWalletAddress);
    } catch (error) {
      console.error('[BaseWallet] Treasury address validation failed:', error);
      setEmailError('Invalid wallet configuration detected. Please contact support.');
      return;
    }

    // Ensure wallet address is stored in localStorage for AuthContext to pick up
    // This is critical for the app to recognize the user is authenticated
    if (effectiveWalletAddress) {
      localStorage.setItem('cdp:wallet_address', effectiveWalletAddress);
      console.log('[BaseWallet] Stored wallet address:', effectiveWalletAddress);
    }

    // Dispatch an event to notify AuthContext to refresh user data
    // This ensures the app state is updated immediately after authentication
    window.dispatchEvent(new CustomEvent('auth-complete', {
      detail: {
        walletAddress: effectiveWalletAddress,
        email: userEmail
      }
    }));

    // Small delay to allow state updates to propagate before closing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Close the modal
    onClose();
  }, [onClose, effectiveWalletAddress, userEmail]);

  // Handler to save email for external wallet users
  // This allows external wallet users to add their email for profile features
  const handleSaveEmail = useCallback(async () => {
    if (!pendingEmail || !effectiveWalletAddress) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(pendingEmail)) {
      console.warn('[BaseWallet] Invalid email format');
      return;
    }

    setIsSavingEmail(true);
    try {
      const normalizedEmail = pendingEmail.toLowerCase().trim();

      // Update the user's profile with the email
      const { error } = await supabase
        .from('canonical_users')
        .update({
          email: normalizedEmail,
          username: normalizedEmail.split('@')[0], // Update username from email
        })
        .or(`wallet_address.eq.${effectiveWalletAddress},base_wallet_address.eq.${effectiveWalletAddress},privy_user_id.eq.${effectiveWalletAddress}`);

      if (error) {
        console.error('[BaseWallet] Error saving email:', error);
      } else {
        console.log('[BaseWallet] Email saved successfully');
        setUserEmail(normalizedEmail);
        setEmailSaved(true);
      }
    } catch (error) {
      console.error('[BaseWallet] Error saving email:', error);
    } finally {
      setIsSavingEmail(false);
    }
  }, [pendingEmail, effectiveWalletAddress]);

  // Handler for "I already have a wallet" - go directly to CDP sign in
  const handleExistingWallet = useCallback(async () => {
    // Clear any stale session before showing sign-in
    await clearStaleSession();
    // Go to creating state which shows the CDP SignIn component
    // This allows users with existing Base wallets to sign in
    setFlowState('creating');
  }, [clearStaleSession]);

  // Handler for "Create My Free Wallet" - clear stale session and show sign-in
  const handleCreateWallet = useCallback(async () => {
    // Clear any stale session before showing sign-in
    await clearStaleSession();
    setFlowState('creating');
  }, [clearStaleSession]);

  // Handler for "Connect with Base App" - show wagmi wallet connection UI
  // Uses the inline ConnectWallet component for both mobile and desktop
  // The wagmi configuration with smartWalletOnly handles mobile deep-linking properly
  const handleConnectBaseApp = useCallback(() => {
    console.log('[BaseWallet] Opening connect-wallet flow');
    setFlowState('connect-wallet');
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="bg-[#101010] border border-white/10 rounded-2xl p-5 w-full max-w-md relative max-h-[90vh] overflow-y-auto">
        <button
          className="absolute right-4 top-4 text-white/60 hover:text-white"
          onClick={onClose}
          aria-label="Close authentication modal"
        >
          <X size={18} />
        </button>

        {/* SUCCESS STATE - Wallet created, show details */}
        {flowState === 'success' && effectiveWalletAddress && (
          <div className="flex flex-col items-center" role="status" aria-live="polite">
            <div className="w-20 h-20 bg-gradient-to-br from-[#0052FF] to-[#DDE404] rounded-full flex items-center justify-center mb-4">
              <CheckCircle size={40} className="text-white" aria-hidden="true" />
            </div>

            <h2 id="auth-modal-title" className="text-white text-xl font-bold mb-2">Your Base Account is Ready!</h2>
            <p className="text-white/60 text-sm mb-4 text-center">
              Your free Base Smart Wallet on the Base network
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

            {/* Email collection for external wallet users - optional but recommended */}
            {!userEmail && !emailSaved && (
              <div className="w-full bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg p-4 mb-4">
                <p className="text-white text-sm font-semibold mb-2">Add Your Email (Optional)</p>
                <p className="text-white/60 text-xs mb-3">
                  Add your email to unlock full profile features including username customization and account management.
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={pendingEmail}
                    onChange={(e) => setPendingEmail(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#0052FF]"
                  />
                  <button
                    onClick={handleSaveEmail}
                    disabled={isSavingEmail || !pendingEmail}
                    className="bg-[#0052FF] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#0052FF]/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingEmail ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {/* How to access - different message for embedded vs external wallets */}
            {userEmail ? (
              <div className="w-full bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
                <p className="text-white text-sm font-semibold mb-2">Access Your Base Account</p>
                <p className="text-white/60 text-xs">
                  Download the <span className="text-[#0052FF]">Base</span> app and sign in with <span className="text-white">{userEmail}</span> to manage your funds.
                </p>
              </div>
            ) : (
              <div className="w-full bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
                <p className="text-white text-sm font-semibold mb-2">Wallet Connected</p>
                <p className="text-white/60 text-xs">
                  Your <span className="text-[#0052FF]">external wallet</span> is now connected. Use the same wallet app to manage your funds and make purchases.
                </p>
              </div>
            )}

            {/* Next step */}
            <div className="w-full bg-[#DDE404]/10 border border-[#DDE404]/30 rounded-lg p-4 mb-4">
              <p className="text-[#DDE404] text-sm font-semibold mb-1">Final Step</p>
              <p className="text-white/60 text-xs">
                Click below to authenticate and start entering competitions!
              </p>
            </div>

            <button
              onClick={handleAuthenticate}
              className="w-full bg-[#DDE404] text-black font-bold py-3 rounded-lg hover:bg-[#DDE404]/90"
            >
              Authenticate & Continue
            </button>
            
            <button
              onClick={onClose}
              className="w-full mt-2 text-white/40 text-xs py-2 hover:text-white/60"
            >
              I'll do this later
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

        {/* INTRO STATE */}
        {flowState === 'intro' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-[#0052FF] rounded-full flex items-center justify-center mb-4">
              <Wallet size={32} className="text-white" aria-hidden="true" />
            </div>

            <h2 id="auth-modal-title" className="text-white text-xl font-bold mb-2">Welcome, {userEmail.split('@')[0]}!</h2>
            <p className="text-white/60 text-sm mb-2">Choose how to set up your account</p>

            {/* Email confirmation badge */}
            <div className="w-full bg-white/5 border border-white/10 rounded-lg p-2 mb-4 flex items-center justify-center gap-2">
              <CheckCircle size={14} className="text-[#DDE404]" />
              <span className="text-white/70 text-xs">{userEmail}</span>
            </div>

            <div className="w-full bg-[#DDE404]/10 border border-[#DDE404]/30 rounded-lg p-3 mb-4" role="note">
              <p className="text-[#DDE404] text-sm font-semibold text-center">
                50% Top Up Bonus on your first deposit!
              </p>
            </div>

            <button
              onClick={handleCreateWallet}
              disabled={isClearing}
              aria-busy={isClearing}
              aria-describedby="create-wallet-description"
              className="w-full bg-[#0052FF] text-white font-bold py-3 rounded-lg hover:bg-[#0052FF]/90 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Wallet size={18} aria-hidden="true" />
              {isClearing ? 'Preparing...' : 'Create a Free Base Account'}
            </button>
            <span id="create-wallet-description" className="sr-only">Create a new Base smart wallet using your email address</span>

            <button
              onClick={handleConnectBaseApp}
              disabled={isClearing}
              aria-busy={isClearing}
              aria-describedby="connect-wallet-description"
              className="w-full mt-3 bg-[#DDE404] text-black font-bold py-3 rounded-lg hover:bg-[#DDE404]/90 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Smartphone size={18} aria-hidden="true" />
              Connect existing Base wallet
            </button>
            <span id="connect-wallet-description" className="sr-only">Connect an existing wallet from the Base mobile app</span>

            <button
              onClick={() => setFlowState('email-first')}
              className="w-full mt-4 text-white/40 text-xs py-2 hover:text-white/60"
            >
              ← Use a different email
            </button>
          </div>
        )}

        {/* EMAIL-FIRST STATE - Collect email before showing options */}
        {flowState === 'email-first' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-[#0052FF] rounded-full flex items-center justify-center mb-4">
              <Wallet size={32} className="text-white" aria-hidden="true" />
            </div>

            <h2 id="auth-modal-title" className="text-white text-xl font-bold mb-2">Welcome to ThePrize</h2>
            <p className="text-white/60 text-sm mb-6 text-center">Enter your email to get started</p>

            {/* Info banner */}
            <div className="w-full bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg p-3 mb-4">
              <p className="text-[#0052FF] text-xs text-center">
                We link accounts by email to keep your identity secure and prevent duplicates.
              </p>
            </div>

            <div className="w-full space-y-4 mb-4">
              <div className="flex flex-col">
                <label className="text-white/70 text-sm mb-2">Email Address</label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setEmailError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleEmailCheck();
                    }
                  }}
                  className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#0052FF]"
                  autoFocus
                />
                {emailError && (
                  <span className="text-red-400 text-xs mt-2">{emailError}</span>
                )}
              </div>
            </div>

            <button
              onClick={handleEmailCheck}
              disabled={isCheckingEmail || !emailInput.trim()}
              className="w-full bg-[#0052FF] text-white font-bold py-3 rounded-lg hover:bg-[#0052FF]/90 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isCheckingEmail ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Checking...
                </>
              ) : (
                <>
                  <ArrowRight size={18} />
                  Continue
                </>
              )}
            </button>

            <div className="w-full bg-[#DDE404]/10 border border-[#DDE404]/30 rounded-lg p-3 mt-4" role="note">
              <p className="text-[#DDE404] text-sm font-semibold text-center">
                50% Top Up Bonus on your first deposit!
              </p>
            </div>
          </div>
        )}

        {/* CREATING STATE - CDP SignIn */}
        {flowState === 'creating' && (
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-[#0052FF] rounded-full flex items-center justify-center mb-3">
              <Wallet size={24} className="text-white" aria-hidden="true" />
            </div>

            {/* Show different header for existing vs new users */}
            {existingUserEmail ? (
              <>
                <h3 id="auth-modal-title" className="text-white text-lg font-bold mb-1">Great! You're already a member</h3>
                <p className="text-white/50 text-xs mb-2 text-center">
                  Use <span className="text-white font-medium">{existingUserEmail}</span> to sign in now.
                </p>
                <div className="w-full bg-[#DDE404]/10 border border-[#DDE404]/30 rounded-lg p-3 mb-4">
                  <p className="text-[#DDE404] text-xs text-center">
                    Checking a different account? Enter that email instead.
                  </p>
                </div>
              </>
            ) : (
              <>
                <h3 id="auth-modal-title" className="text-white text-lg font-bold mb-1">Create Your Account</h3>
                <p className="text-white/50 text-xs mb-4">Verify your email to create your Base account</p>
              </>
            )}

            {isClearing ? (
              <div className="w-full flex items-center justify-center py-8" role="status" aria-live="polite">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0052FF]" aria-hidden="true"></div>
                <span className="ml-3 text-white/60 text-sm">Preparing sign-in...</span>
              </div>
            ) : (
              <div className="w-full">
                {/* Email reminder banner - show the collected email and guide user to enter it below */}
                {/* Only show for new users - existing users already see their email in the header above */}
                {userEmail && !existingUserEmail && (
                  <div className="w-full bg-[#0052FF]/20 border-2 border-[#0052FF] rounded-lg p-4 mb-4 relative">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-[#0052FF] rounded-full flex items-center justify-center mt-0.5">
                        <CheckCircle size={16} className="text-white" aria-hidden="true" />
                      </div>
                      <div className="flex-1">
                        <p className="text-white text-sm font-semibold mb-1">
                          Your Email: <span className="text-[#DDE404]">{userEmail}</span>
                        </p>
                        <p className="text-white/80 text-xs">
                          Enter this email in the Base authentication form below to confirm your account
                        </p>
                      </div>
                    </div>
                    {/* Arrow pointing down to the SignIn component */}
                    <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2" aria-hidden="true">
                      <ArrowRight size={24} className="text-[#0052FF] rotate-90" />
                    </div>
                  </div>
                )}

                <SignIn onSuccess={handleSignInSuccess}>
                  {(state: SignInState) => {
                    // Log errors for debugging
                    if (state.error) {
                      console.log('[BaseWallet] CDP error:', state.error);
                      const errorStr = typeof state.error === 'string' ? state.error : (state.error as any)?.message || '';
                      const errorLower = errorStr.toLowerCase();

                      // Handle "email already linked" error - user should continue with OTP
                      if (errorLower.includes('already linked') || errorLower.includes('already associated')) {
                        return (
                          <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg" role="alert">
                            <p className="text-yellow-400 text-xs text-center">
                              This email already has an account. Please enter the verification code sent to your email to sign in.
                            </p>
                          </div>
                        );
                      }

                      // Handle rate limiting errors
                      if (errorLower.includes('rate limit') || errorLower.includes('too many')) {
                        return (
                          <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg" role="alert">
                            <p className="text-red-400 text-xs text-center">
                              Too many attempts. Please wait a moment before trying again.
                            </p>
                          </div>
                        );
                      }

                      // Handle network errors
                      if (errorLower.includes('network') || errorLower.includes('connection') || errorLower.includes('timeout')) {
                        return (
                          <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg" role="alert">
                            <p className="text-red-400 text-xs text-center">
                              Network error. Please check your connection and try again.
                            </p>
                          </div>
                        );
                      }

                      // Handle invalid email errors
                      if (errorLower.includes('invalid email') || errorLower.includes('email format')) {
                        return (
                          <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg" role="alert">
                            <p className="text-red-400 text-xs text-center">
                              Please enter a valid email address.
                            </p>
                          </div>
                        );
                      }

                      // Handle user cancellation (not a real error)
                      if (errorLower.includes('cancelled') || errorLower.includes('rejected') || errorLower.includes('denied')) {
                        return null; // Don't show error for user cancellation
                      }

                      // Generic error fallback for unexpected errors
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
            )}

            <button
              onClick={() => {
                setExistingUserEmail('');
                setFlowState('email-first');
              }}
              className="w-full mt-4 border border-white/20 text-white text-sm py-3 rounded-lg hover:bg-white/5"
            >
              ← Use a different email
            </button>

            {existingUserEmail && (
              <button
                onClick={() => setFlowState('account-recovery')}
                className="w-full mt-2 text-white/40 text-xs py-2 hover:text-white/60"
              >
                Lost access to this email?
              </button>
            )}
          </div>
        )}

        {/* ACCOUNT RECOVERY STATE */}
        {flowState === 'account-recovery' && (
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center mb-3">
              <Shield size={24} className="text-white" aria-hidden="true" />
            </div>
            <h3 id="auth-modal-title" className="text-white text-lg font-bold mb-1">Account Recovery</h3>
            <p className="text-white/50 text-xs mb-4 text-center">
              Lost access to <span className="text-white">{existingUserEmail}</span>?
            </p>

            <div className="w-full bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 mb-4">
              <p className="text-orange-400 text-sm font-semibold mb-2">Recovery Options</p>
              <ul className="text-white/70 text-xs space-y-2">
                <li>• If you have access to your Base wallet app, connect it below to verify ownership</li>
                <li>• Otherwise, contact support with proof of account ownership</li>
              </ul>
            </div>

            <button
              onClick={() => setFlowState('connect-wallet')}
              className="w-full bg-[#DDE404] text-black font-bold py-3 rounded-lg hover:bg-[#DDE404]/90 flex items-center justify-center gap-2"
            >
              <Wallet size={18} aria-hidden="true" />
              Verify with my Base Wallet
            </button>

            <a
              href="mailto:support@theprize.io?subject=Account%20Recovery%20Request"
              className="w-full mt-3 border border-white/20 text-white text-sm py-3 rounded-lg hover:bg-white/5 text-center block"
            >
              Contact Support
            </a>

            <button
              onClick={() => setFlowState('creating')}
              className="w-full mt-4 text-white/40 text-xs py-2 hover:text-white/60"
            >
              ← Back to sign in
            </button>
          </div>
        )}

        {/* CONNECT-WALLET STATE - Connect with Base App / Coinbase Wallet */}
        {flowState === 'connect-wallet' && (
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-[#DDE404] rounded-full flex items-center justify-center mb-3">
              <Smartphone size={24} className="text-black" aria-hidden="true" />
            </div>
            <h3 id="auth-modal-title" className="text-white text-lg font-bold mb-1">Connect Your Base Wallet</h3>
            <p className="text-white/50 text-xs mb-4 text-center">
              Use your existing Base wallet app
            </p>

            <div className="w-full bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
              <p className="text-white/70 text-sm mb-3 text-center">
                Click below to connect your wallet
              </p>
              <div className="flex justify-center">
                <WalletComponent>
                  <ConnectWallet className="w-full">
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

            <div className="w-full bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg p-3 mb-4">
              <p className="text-[#0052FF] text-xs text-center">
                Opens Base Smart Wallet - works on both mobile and desktop
              </p>
            </div>

            <button
              onClick={() => setFlowState('intro')}
              className="w-full border border-white/20 text-white text-sm py-3 rounded-lg hover:bg-white/5"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BaseWalletAuthModal;
