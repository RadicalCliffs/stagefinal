import React, { useEffect, useState, useCallback, useRef } from "react";
import { X, Wallet, CheckCircle, ArrowRight, Shield, Copy, Check, ExternalLink, Smartphone, AlertCircle, Loader2 } from "lucide-react";
import { SignIn, type SignInState } from "@coinbase/cdp-react";
import { useCurrentUser, useEvmAddress, useIsSignedIn, useSignOut } from "@coinbase/cdp-hooks";
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
 *
 * RETURNING USER FLOW:
 * - Returning users are shown the wallet-choice screen directly
 * - They click one button to connect their wallet
 * - The wallet is properly linked to their account via linkWalletToExistingUser
 * - This ensures wallet addresses are always saved to Supabase
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

// Request deduplication tracking with automatic cleanup
// Note: This Map is bounded by setTimeout cleanup after each request
// Maximum theoretical size: (concurrent users * modal opens) within 1 second window
const pendingLinkRequests = new Map<string, Promise<{ success: boolean; userId?: string }>>();
const MAX_PENDING_REQUESTS = 100; // Safety limit to prevent unbounded growth

function validateNotTreasuryAddress(walletAddress: string): void {
  const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS?.toLowerCase();
  if (treasuryAddress && walletAddress.toLowerCase() === treasuryAddress) {
    throw new Error('Invalid wallet address: Treasury address cannot be used as user wallet');
  }
}

/**
 * Find user by email and update with wallet address.
 * This function handles both existing users (link wallet) and new users (create via upsert).
 *
 * This function is CRITICAL for both new and returning users - it ensures
 * the wallet address is properly saved to Supabase.
 *
 * CRITICAL FIX: Now also accepts profile data to create users if they don't exist.
 * This handles the case where email lookup fails but we have valid signup data.
 */
async function linkWalletToExistingUser(
  email: string,
  walletAddress: string,
  profileData?: {
    username?: string;
    firstName?: string;
    lastName?: string;
    country?: string;
    telegram?: string;
    avatar?: string;
  }
): Promise<{ success: boolean; userId?: string; created?: boolean }> {
  try {
    // Validate inputs first - fail fast if missing
    if (!email || !email.trim()) {
      console.error('[BaseWallet] linkWalletToExistingUser called without email');
      return { success: false };
    }
    
    if (!walletAddress || !walletAddress.trim()) {
      console.error('[BaseWallet] linkWalletToExistingUser called without wallet address');
      return { success: false };
    }

    console.log('[BaseWallet] Looking up user by email:', email);
    validateNotTreasuryAddress(walletAddress);

    const normalizedEmail = email.toLowerCase().trim();
    const canonicalUserId = toPrizePid(walletAddress);
    
    // Request deduplication: Check if there's already a pending request for this email+wallet
    const requestKey = `${normalizedEmail}:${walletAddress.toLowerCase()}`;
    const existingRequest = pendingLinkRequests.get(requestKey);
    
    if (existingRequest) {
      console.log('[BaseWallet] Deduplicating request for:', requestKey);
      return existingRequest;
    }
    
    // Safety check: If Map is too large, clear it to prevent memory issues
    if (pendingLinkRequests.size >= MAX_PENDING_REQUESTS) {
      console.warn('[BaseWallet] Pending requests Map exceeded limit, clearing old entries');
      pendingLinkRequests.clear();
    }
    
    // Create new request promise and store it for deduplication
    const requestPromise = (async () => {
      try {

    // Find user by email (case-insensitive)
    // CRITICAL: Use ilike for case-insensitive matching to find pre-created users
    const { data: existingUser, error: fetchError } = await supabase
      .from('canonical_users')
      .select('id, username, email, country, first_name, last_name')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (fetchError) {
      console.error('[BaseWallet] Error finding user by email:', fetchError);
      // Don't return false - fall through to upsert
    }

    if (existingUser) {
      console.log('[BaseWallet] Found user by email, updating with wallet:', existingUser.id);

      // Update user with wallet info - THIS IS CRITICAL for saving wallet to Supabase
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

      // Call attach_identity_after_auth RPC for identity/profile linking
      try {
        const priorPayload = {
          username: existingUser.username || null,
          country: existingUser.country || null,
          first_name: existingUser.first_name || null,
          last_name: existingUser.last_name || null,
        };

        console.log('[BaseWallet] Calling attach_identity_after_auth RPC for existing user');

        const { error: rpcError } = await supabase.rpc('attach_identity_after_auth', {
          in_canonical_user_id: canonicalUserId,
          in_wallet_address: walletAddress.toLowerCase(),
          in_email: normalizedEmail,
          in_privy_user_id: walletAddress,
          in_prior_payload: priorPayload,
          in_base_wallet_address: walletAddress.toLowerCase(),
          in_eth_wallet_address: walletAddress.toLowerCase(),
        });

        if (rpcError) {
          console.warn('[BaseWallet] attach_identity_after_auth RPC warning:', rpcError);
        } else {
          console.log('[BaseWallet] attach_identity_after_auth RPC success');
        }
      } catch (rpcErr) {
        console.warn('[BaseWallet] attach_identity_after_auth RPC exception:', rpcErr);
      }

      // CRITICAL: Call upsert_canonical_user RPC after wallet link completion
      // This ensures canonical_users table is up-to-date with wallet linkage
      // NOTE: Parameters must match the database function signature exactly
      try {
        console.log('[BaseWallet] Calling upsert_canonical_user RPC for wallet link completion');

        const { error: upsertError } = await supabase.rpc('upsert_canonical_user', {
          p_uid: existingUser.id,
          p_canonical_user_id: canonicalUserId,
          p_email: normalizedEmail || null,
          p_username: existingUser.username || null,
          p_wallet_address: walletAddress.toLowerCase(),
          p_base_wallet_address: walletAddress.toLowerCase(),
          p_eth_wallet_address: walletAddress.toLowerCase(),
          p_privy_user_id: walletAddress,
          p_first_name: existingUser.first_name || null,
          p_last_name: existingUser.last_name || null,
          p_telegram_handle: null,
          p_wallet_linked: true, // CRITICAL: This is a wallet link event
        });

        if (upsertError) {
          console.warn('[BaseWallet] upsert_canonical_user RPC warning:', upsertError);
        } else {
          console.log('[BaseWallet] upsert_canonical_user RPC success');
        }
      } catch (upsertErr) {
        console.warn('[BaseWallet] upsert_canonical_user RPC exception:', upsertErr);
      }

      console.log('[BaseWallet] Successfully linked wallet to existing user:', existingUser.id);
      return { success: true, userId: existingUser.id, created: false };
    }

    // CRITICAL FIX: If user not found by email, try to find by wallet address
    // This handles the case where user was created with wallet but email mismatch
    console.log('[BaseWallet] User not found by email, checking by wallet address');

    const { data: existingByWallet } = await supabase
      .from('canonical_users')
      .select('id, username, email, country, first_name, last_name')
      .or(`wallet_address.ilike.${walletAddress.toLowerCase()},base_wallet_address.ilike.${walletAddress.toLowerCase()}`)
      .maybeSingle();

    if (existingByWallet) {
      console.log('[BaseWallet] Found user by wallet address:', existingByWallet.id);

      // Update the email if we have it and the user doesn't
      const updates: Record<string, any> = {
        canonical_user_id: canonicalUserId,
        wallet_linked: true,
        auth_provider: 'cdp',
      };

      if (normalizedEmail && !existingByWallet.email) {
        updates.email = normalizedEmail;
      }

      const { error: updateError } = await supabase
        .from('canonical_users')
        .update(updates)
        .eq('id', existingByWallet.id);

      if (updateError) {
        console.warn('[BaseWallet] Error updating wallet user:', updateError);
      }

      // CRITICAL: Call upsert_canonical_user RPC after wallet link by wallet address
      // NOTE: Parameters must match the database function signature exactly
      try {
        console.log('[BaseWallet] Calling upsert_canonical_user RPC for wallet found by address');

        const { error: upsertError } = await supabase.rpc('upsert_canonical_user', {
          p_uid: existingByWallet.id,
          p_canonical_user_id: canonicalUserId,
          p_email: normalizedEmail || existingByWallet.email || null,
          p_username: existingByWallet.username || null,
          p_wallet_address: walletAddress.toLowerCase(),
          p_base_wallet_address: walletAddress.toLowerCase(),
          p_eth_wallet_address: walletAddress.toLowerCase(),
          p_privy_user_id: walletAddress,
          p_first_name: existingByWallet.first_name || null,
          p_last_name: existingByWallet.last_name || null,
          p_telegram_handle: null,
          p_wallet_linked: true,
        });

        if (upsertError) {
          console.warn('[BaseWallet] upsert_canonical_user RPC warning:', upsertError);
        } else {
          console.log('[BaseWallet] upsert_canonical_user RPC success');
        }
      } catch (upsertErr) {
        console.warn('[BaseWallet] upsert_canonical_user RPC exception:', upsertErr);
      }

      return { success: true, userId: existingByWallet.id, created: false };
    }

    // CRITICAL FIX: If user still not found and we have profile data, create the user
    // This handles the case where OTP was verified but user creation didn't happen yet
    if (profileData?.username || normalizedEmail) {
      console.log('[BaseWallet] User not found, creating via upsert-user edge function');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      try {
        const upsertResponse = await fetch(`${supabaseUrl}/functions/v1/upsert-user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            username: profileData?.username || normalizedEmail.split('@')[0],
            email: normalizedEmail,
            firstName: profileData?.firstName || null,
            lastName: profileData?.lastName || null,
            country: profileData?.country || null,
            telegram: profileData?.telegram || null,
            avatar: profileData?.avatar || null,
            walletAddress: walletAddress,
          }),
        });

        const responseData = await upsertResponse.json();

        if (!upsertResponse.ok) {
          console.error('[BaseWallet] Failed to create user via upsert:', responseData);
          return { success: false };
        }

        console.log('[BaseWallet] User created successfully via upsert:', responseData);
        return { success: true, userId: responseData.user?.id || '', created: true };
      } catch (err) {
        console.error('[BaseWallet] Error calling upsert-user:', err);
        return { success: false };
      }
    }

      } catch (innerError) {
        // Handle any errors from the inner async operations
        console.error('[BaseWallet] Error in linkWalletToExistingUser inner promise:', innerError);
        return { success: false };
      }
    })() as Promise<{ success: boolean; userId?: string; created?: boolean }>;
    
    // Store the promise for deduplication
    pendingLinkRequests.set(requestKey, requestPromise);
    
    // Wait for completion
    const result = await requestPromise;
    
    // Clean up after completion (with small delay to catch rapid retries)
    // This runs regardless of success or failure to prevent memory leaks
    setTimeout(() => {
      pendingLinkRequests.delete(requestKey);
    }, 1000);
    
    return result;
  } catch (error) {
    // Outer catch for any synchronous errors (validation, etc.)
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

    // Build prior_payload for attach_identity_after_auth RPC
    const priorPayload = {
      username: profile.username.toLowerCase(),
      avatar_url: profile.avatar || userDataService.getDefaultAvatar(),
      country: profile.country,
      first_name: profile.fullName?.split(' ')[0] || null,
      last_name: profile.fullName?.split(' ').slice(1).join(' ') || null,
      telegram_handle: profile.socialProfiles || null,
    };

    // Check if user exists by email first (case-insensitive)
    const { data: existingUser } = await supabase
      .from('canonical_users')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    let saveSuccess = false;
    let userId: string | null = null;

    if (existingUser) {
      // Update existing user
      userId = existingUser.id;
      const { error } = await supabase
        .from('canonical_users')
        .update({
          wallet_address: walletAddress.toLowerCase(),
          base_wallet_address: walletAddress.toLowerCase(),
          eth_wallet_address: walletAddress.toLowerCase(),
          privy_user_id: walletAddress,
          canonical_user_id: canonicalUserId,
          username: profile.username.toLowerCase(),
          first_name: profile.fullName?.split(' ')[0] || null,
          last_name: profile.fullName?.split(' ').slice(1).join(' ') || null,
          country: profile.country,
          avatar_url: profile.avatar || userDataService.getDefaultAvatar(),
          telephone_number: profile.mobile || null,
          telegram_handle: profile.socialProfiles || null,
          wallet_linked: true,
          auth_provider: 'cdp',
        })
        .eq('id', existingUser.id);
      saveSuccess = !error;
    } else {
      // Create new user if not found
      const { data: newUser, error } = await supabase
        .from('canonical_users')
        .insert({
          canonical_user_id: canonicalUserId,
          email: normalizedEmail,
          wallet_address: walletAddress.toLowerCase(),
          base_wallet_address: walletAddress.toLowerCase(),
          eth_wallet_address: walletAddress.toLowerCase(),
          privy_user_id: walletAddress,
          username: profile.username.toLowerCase(),
          first_name: profile.fullName?.split(' ')[0] || null,
          last_name: profile.fullName?.split(' ').slice(1).join(' ') || null,
          country: profile.country,
          avatar_url: profile.avatar || userDataService.getDefaultAvatar(),
          telephone_number: profile.mobile || null,
          telegram_handle: profile.socialProfiles || null,
          usdc_balance: 0,
          has_used_new_user_bonus: false,
          wallet_linked: true,
          auth_provider: 'cdp',
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error && error.code !== '23505') {
        console.error('[BaseWallet] Error creating user:', error);
        return false;
      }
      userId = newUser?.id || null;
      saveSuccess = true;
    }

    // Call attach_identity_after_auth RPC for profile linking
    // This is a transactional RPC that handles profile creation and prior_signup_payload merging
    if (saveSuccess) {
      try {
        console.log('[BaseWallet] Calling attach_identity_after_auth RPC after profile completion');

        const { error: rpcError } = await supabase.rpc('attach_identity_after_auth', {
          in_canonical_user_id: canonicalUserId,
          in_wallet_address: walletAddress.toLowerCase(),
          in_email: normalizedEmail,
          in_privy_user_id: walletAddress,
          in_prior_payload: priorPayload,
          in_base_wallet_address: walletAddress.toLowerCase(),
          in_eth_wallet_address: walletAddress.toLowerCase(),
        });

        if (rpcError) {
          // Log but don't fail - user was already saved successfully
          console.warn('[BaseWallet] attach_identity_after_auth RPC warning:', rpcError);
        } else {
          console.log('[BaseWallet] attach_identity_after_auth RPC success');
        }
      } catch (rpcErr) {
        // Non-blocking - don't fail if RPC fails
        console.warn('[BaseWallet] attach_identity_after_auth RPC exception:', rpcErr);
      }

      // CRITICAL: Call upsert_canonical_user RPC after profile completion with wallet link
      // NOTE: Parameters must match the database function signature exactly
      try {
        console.log('[BaseWallet] Calling upsert_canonical_user RPC after profile completion');

        const { error: upsertError } = await supabase.rpc('upsert_canonical_user', {
          p_uid: userId || canonicalUserId,  // Use userId if available, fallback to canonicalUserId
          p_canonical_user_id: canonicalUserId,
          p_email: normalizedEmail,
          p_username: profile.username.toLowerCase(),
          p_wallet_address: walletAddress.toLowerCase(),
          p_base_wallet_address: walletAddress.toLowerCase(),
          p_eth_wallet_address: walletAddress.toLowerCase(),
          p_privy_user_id: walletAddress,
          p_first_name: profile.fullName?.split(' ')[0] || null,
          p_last_name: profile.fullName?.split(' ').slice(1).join(' ') || null,
          p_telegram_handle: profile.socialProfiles || null,
          p_wallet_linked: true,
        });

        if (upsertError) {
          console.warn('[BaseWallet] upsert_canonical_user RPC warning:', upsertError);
        } else {
          console.log('[BaseWallet] upsert_canonical_user RPC success');
        }
      } catch (upsertErr) {
        console.warn('[BaseWallet] upsert_canonical_user RPC exception:', upsertErr);
      }
    }

    return saveSuccess;
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
  // Track if we're waiting for the wallet address after CDP sign-in
  const [waitingForWallet, setWaitingForWallet] = useState(false);
  const walletPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track wallet connection attempt timeout
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionTimedOut, setConnectionTimedOut] = useState(false);
  // Track last connection attempt to debounce rapid re-triggers
  const lastConnectionAttemptRef = useRef<number>(0);
  const DEBOUNCE_MS = 500; // Minimum time between connection attempts

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      savedToDbRef.current = false;
      profileCheckedRef.current = false;
      setEmailError('');
      setWaitingForWallet(false);
      setConnectionTimedOut(false);

      // Clear any existing auto-close timer
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }

      // Clear any existing wallet poll interval
      if (walletPollIntervalRef.current) {
        clearInterval(walletPollIntervalRef.current);
        walletPollIntervalRef.current = null;
      }

      // Clear any connection timeout
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      // Set userEmail from options if provided
      if (options?.email) {
        setUserEmail(options.email);
      }

      // Determine initial flow state based on options
      // CRITICAL: Returning users MUST go to wallet-choice, NOT cdp-signin
      // cdp-signin creates a NEW wallet - we want to CONNECT an existing wallet
      console.log('[BaseWallet] Modal opened with options:', {
        isReturningUser: options?.isReturningUser,
        connectExisting: options?.connectExisting,
        createNew: options?.createNew,
        hasEmail: !!options?.email,
        hasWalletAddress: !!options?.returningUserWalletAddress,
      });

      if (options?.isReturningUser || options?.connectExisting) {
        // Returning user or connecting existing wallet - go straight to wallet choice
        // This shows ONLY the "Connect wallet" button, no create new wallet option
        console.log('[BaseWallet] Routing to wallet-choice (returning user flow)');
        setFlowState('wallet-choice');
      } else if (options?.createNew) {
        // User explicitly wants to create a new wallet - go to CDP sign-in
        console.log('[BaseWallet] Routing to cdp-signin (new wallet creation)');
        setFlowState('cdp-signin');
      } else {
        // Default to CDP sign-in for new users without explicit options
        console.log('[BaseWallet] Routing to cdp-signin (default/new user)');
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

    // Cleanup timers on unmount
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }
      if (walletPollIntervalRef.current) {
        clearInterval(walletPollIntervalRef.current);
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };
  }, [isOpen, options]);

  // Track wallet connection attempts and timeout to prevent stuck loading state
  // This helps when the wallet popup is dismissed without completing the connection
  useEffect(() => {
    if (isConnecting && flowState === 'wallet-choice') {
      // Start a timeout when connection attempt begins
      connectionTimeoutRef.current = setTimeout(() => {
        console.log('[BaseWallet] Wallet connection attempt timed out');
        setConnectionTimedOut(true);
        setEmailError('Connection timed out. Please try again.');
      }, 60000); // 60 second timeout for wallet connection
    } else {
      // Clear timeout if not connecting
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      // Reset timeout state if we're no longer connecting and wallet is now connected
      if (wagmiIsConnected && connectionTimedOut) {
        setConnectionTimedOut(false);
        setEmailError('');
      }
    }

    return () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };
  }, [isConnecting, flowState, wagmiIsConnected, connectionTimedOut]);

  // Handle CDP sign-in success - create user with wallet or link to existing user
  // This effect may need to wait for evmAddress to become available after CDP sign-in
  useEffect(() => {
    const handleCDPSignInSuccess = async () => {
      // First check: CDP is signed in but no wallet address yet
      // This happens because the CDP SignIn component shows "Success!" before the wallet is ready
      if (flowState === 'cdp-signin' && cdpIsSignedIn && !evmAddress && currentUser && !waitingForWallet) {
        console.log('[BaseWallet] CDP signed in but waiting for wallet address...');
        setWaitingForWallet(true);

        // Start polling for wallet address with a timeout
        let pollCount = 0;
        const maxPolls = 30; // 30 * 200ms = 6 seconds max wait

        walletPollIntervalRef.current = setInterval(() => {
          pollCount++;
          console.log(`[BaseWallet] Polling for wallet address... (${pollCount}/${maxPolls})`);

          if (pollCount >= maxPolls) {
            // Timeout - wallet address never arrived
            console.error('[BaseWallet] Timeout waiting for wallet address');
            if (walletPollIntervalRef.current) {
              clearInterval(walletPollIntervalRef.current);
              walletPollIntervalRef.current = null;
            }
            setWaitingForWallet(false);
            setEmailError('Wallet initialization timed out. Please try again.');
            profileCheckedRef.current = false;
          }
        }, 200);

        return; // Exit and wait for evmAddress to trigger this effect again
      }

      // Second check: All conditions met - CDP signed in AND wallet address available
      if (flowState === 'cdp-signin' && cdpIsSignedIn && evmAddress && currentUser && !profileCheckedRef.current) {
        // Clear polling interval if it was running
        if (walletPollIntervalRef.current) {
          clearInterval(walletPollIntervalRef.current);
          walletPollIntervalRef.current = null;
        }
        setWaitingForWallet(false);
        profileCheckedRef.current = true;

        // Check if we have pending signup data from NewAuthModal FIRST
        // This data contains the verified email from the OTP step
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

        // Get email from CDP currentUser (multiple possible locations)
        const cdpEmail = (currentUser as any).email ||
                     (currentUser as any).emails?.[0]?.value ||
                     (currentUser as any).emails?.[0]?.address ||
                     (currentUser as any).linkedAccounts?.find((a: any) => a.type === 'email')?.email;

        // CRITICAL: Use email from pending signup data first (already verified via OTP)
        // Fall back to CDP email if no pending data
        const effectiveEmail = pendingData?.profileData?.email || pendingData?.email || cdpEmail;

        if (effectiveEmail) {
          setUserEmail(effectiveEmail);
          console.log('[BaseWallet] CDP sign-in successful:', { email: effectiveEmail, wallet: evmAddress, source: pendingData?.profileData?.email ? 'pendingSignupData' : 'CDP' });

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

              // Improved fetch with timeout and better error handling
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

              let upsertResponse: Response;
              try {
                upsertResponse = await fetch(`${supabaseUrl}/functions/v1/upsert-user`, {
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
                  signal: controller.signal,
                });
              } catch (fetchError) {
                clearTimeout(timeoutId);
                // Handle network errors gracefully - still proceed with wallet creation
                console.warn('[BaseWallet] Network error calling upsert-user, continuing with wallet:', fetchError);
                // Try to save directly to Supabase as fallback
                const directResult = await linkWalletToExistingUser(userEmail, evmAddress, {
                  username: formProfileData.username,
                  firstName: formProfileData.firstName,
                  lastName: formProfileData.lastName,
                  country: formProfileData.country,
                  telegram: formProfileData.telegram,
                  avatar: formProfileData.avatar,
                });
                if (directResult.success) {
                  savedToDbRef.current = true;
                  localStorage.setItem('cdp:wallet_address', evmAddress);
                  window.dispatchEvent(new CustomEvent('auth-complete', {
                    detail: { walletAddress: evmAddress, email: userEmail }
                  }));
                  setFlowState('logged-in-success');
                  return;
                }
                throw new Error('Connection error. Please check your network and try again.');
              }
              clearTimeout(timeoutId);

              let responseData;
              try {
                responseData = await upsertResponse.json();
              } catch (jsonError) {
                console.warn('[BaseWallet] Failed to parse upsert response, continuing:', jsonError);
                // Response may not be JSON, but if status is ok, continue
                if (upsertResponse.ok || upsertResponse.status === 201) {
                  responseData = { user: { id: '' } }; // Placeholder
                } else {
                  throw new Error('Server returned an invalid response. Please try again.');
                }
              }

              if (!upsertResponse.ok && upsertResponse.status !== 201) {
                console.error('[BaseWallet] Failed to create user:', responseData);
                throw new Error(responseData?.error || 'Failed to create account. Please try again.');
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
                detail: { walletAddress: evmAddress, email: effectiveEmail }
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
          // No email found from any source
          // If we have a wallet, we might still be able to proceed in some cases
          // Show profile completion form to collect user data including email
          console.error('[BaseWallet] CDP sign-in succeeded but no email found in currentUser or pendingSignupData');
          console.log('[BaseWallet] Showing profile completion form to collect missing data');
          // Allow user to complete profile manually
          setFlowState('profile-completion');
        }
      }
    };

    void handleCDPSignInSuccess();

    // Cleanup polling interval when effect re-runs or unmounts
    return () => {
      if (walletPollIntervalRef.current) {
        clearInterval(walletPollIntervalRef.current);
        walletPollIntervalRef.current = null;
      }
    };
  }, [flowState, cdpIsSignedIn, evmAddress, currentUser, waitingForWallet]);

  // Handle external wallet connection (wagmi) - USED FOR BOTH NEW AND RETURNING USERS
  // This is the SIMPLE flow: user connects wallet, we link it to their account
  useEffect(() => {
    const handleWagmiConnection = async () => {
      if (flowState === 'wallet-choice' && wagmiIsConnected && wagmiAddress && !savedToDbRef.current) {
        // Debounce: Check if we recently attempted a connection
        const now = Date.now();
        const timeSinceLastAttempt = now - lastConnectionAttemptRef.current;
        
        if (timeSinceLastAttempt < DEBOUNCE_MS) {
          console.log('[BaseWallet] Debouncing connection attempt, too soon after last attempt');
          return;
        }
        
        // Update last attempt timestamp
        lastConnectionAttemptRef.current = now;
        
        console.log('[BaseWallet] External wallet connected:', wagmiAddress);

        // Check if we have pending signup data from NewAuthModal
        const pendingDataStr = localStorage.getItem('pendingSignupData');
        let pendingData = null;
        if (pendingDataStr) {
          try {
            pendingData = JSON.parse(pendingDataStr);
            // DON'T clear it yet - we'll clear after successful connection
            console.log('[BaseWallet] Found pending signup data:', {
              isReturningUser: pendingData?.isReturningUser,
              hasProfileData: !!pendingData?.profileData,
              profileEmail: pendingData?.profileData?.email ? '***' : undefined,
            });
          } catch (e) {
            console.error('[BaseWallet] Failed to parse pending signup data:', e);
          }
        }

        // CRITICAL FIX: For returning users, the email comes from options (passed from NewAuthModal)
        // NOT from pendingData.profileData (which may be empty for returning users)
        // Use the userEmail state (set from options.email) as the primary source
        const effectiveEmailForLinking = userEmail || pendingData?.profileData?.email || options?.email;

        console.log('[BaseWallet] Effective email for linking:', {
          userEmail: userEmail ? '***' : undefined,
          pendingDataEmail: pendingData?.profileData?.email ? '***' : undefined,
          optionsEmail: options?.email ? '***' : undefined,
          effectiveEmail: effectiveEmailForLinking ? '***' : undefined,
          isReturningUser: pendingData?.isReturningUser || options?.isReturningUser,
        });

        // VALIDATION: Ensure we have an email before attempting to link
        // This prevents silent failures when email is missing
        if (!effectiveEmailForLinking || !effectiveEmailForLinking.trim()) {
          console.error('[BaseWallet] Cannot link wallet - no email available');
          setEmailError('Unable to link wallet. Email is required. Please try logging in again.');
          savedToDbRef.current = false; // Allow retry
          return;
        }

        // RETURNING USER FLOW: If this is a returning user, link wallet to existing account
        // Returning users already have an account - we just need to link the wallet
        // CRITICAL FIX: Pass profile data so we can create user if they don't exist
        if ((pendingData?.isReturningUser || options?.isReturningUser) && effectiveEmailForLinking) {
          console.log('[BaseWallet] Returning user flow - linking wallet to existing user');

          // Get profile data from pendingData in case we need to create the user
          const profileDataForLink = pendingData?.profileData ? {
            username: pendingData.profileData.username,
            firstName: pendingData.profileData.firstName,
            lastName: pendingData.profileData.lastName,
            country: pendingData.profileData.country,
            telegram: pendingData.profileData.telegram,
            avatar: pendingData.profileData.avatar,
          } : undefined;

          const result = await linkWalletToExistingUser(effectiveEmailForLinking, wagmiAddress, profileDataForLink);

          if (result.success) {
            // Clear pending data after successful connection
            localStorage.removeItem('pendingSignupData');
            savedToDbRef.current = true;
            localStorage.setItem('cdp:wallet_address', wagmiAddress);

            window.dispatchEvent(new CustomEvent('auth-complete', {
              detail: { walletAddress: wagmiAddress, email: effectiveEmailForLinking }
            }));

            setFlowState('logged-in-success');
          } else {
            // CRITICAL FIX: Instead of showing error, try to create the user
            // The user may have been created during signup but lookup failed
            console.log('[BaseWallet] Link failed, user may not exist yet. Showing error but user can retry.');
            setEmailError('Unable to connect wallet to account. Please try signing up again or contact support.');
          }
          return;
        }

        // NEW USER FLOW: If we have pending profile data with email, create user with wallet
        if (pendingData?.profileData?.email) {
          console.log('[BaseWallet] Creating user with profile data + external wallet');
          const profileData = pendingData.profileData;

          try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

            // Improved fetch with timeout and better error handling
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            let upsertResponse: Response;
            try {
              upsertResponse = await fetch(`${supabaseUrl}/functions/v1/upsert-user`, {
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
                signal: controller.signal,
              });
            } catch (fetchError) {
              clearTimeout(timeoutId);
              // Network error - try direct Supabase as fallback
              console.warn('[BaseWallet] Network error, trying direct link:', fetchError);
              const directResult = await linkWalletToExistingUser(profileData.email, wagmiAddress, {
                username: profileData.username,
                firstName: profileData.firstName,
                lastName: profileData.lastName,
                country: profileData.country,
                telegram: profileData.telegram,
                avatar: profileData.avatar,
              });
              if (directResult.success) {
                localStorage.removeItem('pendingSignupData');
                savedToDbRef.current = true;
                localStorage.setItem('cdp:wallet_address', wagmiAddress);
                window.dispatchEvent(new CustomEvent('auth-complete', {
                  detail: { walletAddress: wagmiAddress, email: profileData.email }
                }));
                setFlowState('logged-in-success');
                return;
              }
              throw new Error('Connection error. Please check your network.');
            }
            clearTimeout(timeoutId);

            if (!upsertResponse.ok && upsertResponse.status !== 201) {
              throw new Error('Failed to create account');
            }

            // Clear pending data after successful creation
            localStorage.removeItem('pendingSignupData');
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
        } else if (effectiveEmailForLinking) {
          // Fallback: Link wallet to existing user by email
          // CRITICAL FIX: Pass profile data so we can create user if they don't exist
          console.log('[BaseWallet] Fallback - linking wallet to existing user by email');

          const profileDataForFallback = pendingData?.profileData ? {
            username: pendingData.profileData.username,
            firstName: pendingData.profileData.firstName,
            lastName: pendingData.profileData.lastName,
            country: pendingData.profileData.country,
            telegram: pendingData.profileData.telegram,
            avatar: pendingData.profileData.avatar,
          } : undefined;

          const result = await linkWalletToExistingUser(effectiveEmailForLinking, wagmiAddress, profileDataForFallback);

          if (result.success) {
            localStorage.removeItem('pendingSignupData');
            savedToDbRef.current = true;
            localStorage.setItem('cdp:wallet_address', wagmiAddress);

            window.dispatchEvent(new CustomEvent('auth-complete', {
              detail: { walletAddress: wagmiAddress, email: effectiveEmailForLinking }
            }));

            setFlowState('logged-in-success');
          } else {
            setEmailError('Unable to connect wallet. Please try again or contact support.');
          }
        } else {
          // No email available - this shouldn't happen for authenticated users
          // Show error instead of silently succeeding
          console.error('[BaseWallet] No email available for wallet linking');
          setEmailError('Unable to link wallet. Please try logging in again.');
        }
      }
    };

    handleWagmiConnection();
  }, [flowState, wagmiIsConnected, wagmiAddress, userEmail, options?.email, options?.isReturningUser]);

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
            <p className="text-white/60 text-sm mb-4 text-center">
              {textOverrides?.loginSubtitle || 'Choose how you want to sign in'}
            </p>

            {/* Primary option: Sign in with existing Base Account */}
            <button
              onClick={() => setFlowState('wallet-choice')}
              className="w-full bg-[#0052FF] hover:bg-[#0052FF]/90 text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center gap-3 mb-4 shadow-lg shadow-[#0052FF]/20"
            >
              <Shield size={22} className="flex-shrink-0" />
              <div className="flex flex-col items-start">
                <span className="text-base">Sign in with Base Account</span>
                <span className="text-xs text-white/70 font-normal">Access all wallets in your account</span>
              </div>
            </button>

            {/* Divider */}
            <div className="relative w-full py-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-[#101010] px-3 text-white/40">or create a new wallet</span>
              </div>
            </div>

            <p className="text-white/60 text-sm mb-2 text-center">
              Enter your email to verify and create your free Base wallet in one step.
            </p>

            {/* Show loading state when waiting for wallet after OTP verification */}
            {waitingForWallet ? (
              <div className="w-full py-8 flex flex-col items-center justify-center">
                <Loader2 className="animate-spin text-[#0052FF] mb-4" size={40} />
                <p className="text-white/80 text-sm text-center">
                  Setting up your wallet...
                </p>
                <p className="text-white/50 text-xs text-center mt-1">
                  This may take a few seconds
                </p>
              </div>
            ) : (
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
            )}

            {emailError && (
              <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg" role="alert">
                <div className="flex items-start gap-2 text-red-400 text-xs justify-center">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span className="break-words">{emailError}</span>
                </div>
              </div>
            )}

            <p className="mt-4 text-white/40 text-xs text-center">
              You won't have to do this again if you have your wallet saved on phone or desktop
            </p>
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
              {options?.isReturningUser ? 'Welcome back!' : 'Connect your wallet'}
            </h2>
            <p className="text-white/60 text-sm mb-6 text-center">
              {options?.isReturningUser
                ? 'Connect your wallet to sign in to your account.'
                : options?.resumeSignup
                  ? 'Almost there! Connect your wallet to complete signup.'
                  : 'Connect an existing wallet or create a new one in seconds.'
              }
            </p>

            {/* Display returning user's wallet address if available */}
            {options?.isReturningUser && options?.returningUserWalletAddress && (
              <div className="mb-4 p-4 bg-white/5 border border-white/10 rounded-lg">
                <div className="text-xs text-white/50 mb-1">Your wallet</div>
                <div className="text-white font-mono text-sm break-all">
                  {truncateWalletAddress(options.returningUserWalletAddress)}
                </div>
              </div>
            )}

            <div className="w-full space-y-4 mb-6">
              {/* Primary Button - Connect Existing Wallet (Blue) */}
              {!wagmiIsConnected ? (
                <>
                  <div className="space-y-3">
                    {/* Show loading indicator when connection is in progress */}
                    {isConnecting && (
                      <div className="p-4 bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg text-center">
                        <div className="flex items-center justify-center gap-2 text-[#0052FF] mb-2">
                          <Loader2 size={20} className="animate-spin flex-shrink-0" />
                          <span className="font-semibold">Connecting wallet...</span>
                        </div>
                        <p className="text-white/60 text-xs">
                          Please complete the connection in your wallet app or browser popup.
                        </p>
                      </div>
                    )}

                    {/* Show timeout/error message with retry button */}
                    {connectionTimedOut && !isConnecting && (
                      <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-center">
                        <div className="flex items-center justify-center gap-2 text-yellow-400 mb-2">
                          <AlertCircle size={20} className="flex-shrink-0" />
                          <span className="font-semibold">Connection timed out</span>
                        </div>
                        <p className="text-white/60 text-xs mb-3">
                          The wallet connection took too long. Please try again.
                        </p>
                        <button
                          onClick={() => {
                            setConnectionTimedOut(false);
                            setEmailError('');
                          }}
                          className="text-[#0052FF] text-sm font-semibold hover:underline"
                        >
                          Dismiss and try again
                        </button>
                      </div>
                    )}

                    {/* CRITICAL FIX: Direct wallet connection buttons to reduce clicks */}
                    {/* Use wagmi connect directly instead of OnchainKit ConnectWallet */}
                    {!connectionTimedOut && !isConnecting && (
                      <div className="space-y-3">
                        {/* Primary: Sign in with Base Account - gives access to ALL wallets in account */}
                        <button
                          onClick={() => {
                            const cbConnector = connectors.find(
                              (c) => c.id === 'coinbaseWalletSDK' || c.id === 'coinbaseWallet' || c.name.toLowerCase().includes('coinbase')
                            );
                            if (cbConnector) {
                              setEmailError('');
                              connect({ connector: cbConnector });
                            } else {
                              setEmailError('Coinbase Wallet connector not found. Please refresh and try again.');
                            }
                          }}
                          disabled={isConnecting}
                          className="w-full bg-[#0052FF] hover:bg-[#0052FF]/90 text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg shadow-[#0052FF]/20"
                        >
                          <Shield size={22} className="flex-shrink-0" />
                          <div className="flex flex-col items-start">
                            <span className="text-base">
                              {options?.isReturningUser
                                ? 'Sign in with Base Account'
                                : 'Sign in with Base Account'}
                            </span>
                            <span className="text-xs text-white/70 font-normal">
                              Access all wallets in your account
                            </span>
                          </div>
                        </button>

                        {/* Divider for other options */}
                        <div className="relative py-2">
                          <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-white/10"></div>
                          </div>
                          <div className="relative flex justify-center text-xs">
                            <span className="bg-[#101010] px-3 text-white/40">or connect with</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {/* MetaMask button */}
                          <button
                            onClick={handleConnectMetaMask}
                            disabled={isConnecting}
                            className="bg-[#E8821E] hover:bg-[#E8821E]/90 text-white font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                          >
                            <Wallet size={18} className="flex-shrink-0" />
                            <span>MetaMask</span>
                          </button>

                          {/* Other wallets (injected) */}
                          <button
                            onClick={() => {
                              const injectedConnector = connectors.find((c) => c.id === 'injected');
                              if (injectedConnector) {
                                setEmailError('');
                                connect({ connector: injectedConnector });
                              } else {
                                setEmailError('No browser wallet detected. Please install a wallet extension.');
                              }
                            }}
                            disabled={isConnecting}
                            className="bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                          >
                            <Wallet size={18} className="flex-shrink-0" />
                            <span>Other Wallet</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Loading state for when connection is in progress but buttons hidden */}
                    {isConnecting && connectionTimedOut && (
                      <div className="text-center py-4">
                        <Loader2 className="animate-spin text-[#0052FF] mx-auto" size={32} />
                      </div>
                    )}

                    <p className="text-white/60 text-xs text-center">
                      {options?.isReturningUser
                        ? 'Click the button above to connect and sign in.'
                        : options?.resumeSignup
                          ? 'If you have Coinbase Wallet or another Base-compatible wallet, connect it now. Otherwise, create a free wallet below.'
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
