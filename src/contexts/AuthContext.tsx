import { createContext, useCallback, useContext, useEffect, useState, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useCurrentUser, useIsSignedIn, useEvmAddress, useSignOut } from '@coinbase/cdp-hooks';
import { useAccount, useDisconnect } from 'wagmi';
import { userAuth, type UserProfile } from '../lib/user-auth';
import { supabase } from '../lib/supabase';
import { userDataService } from '../services/userDataService';
import { toPrizePid } from '../utils/userId';
import { toCanonicalUserId } from '../lib/canonicalUserId';
import { withRetry } from '../lib/error-handler';

interface LinkedWallet {
  address: string;
  type: string;
  balance?: number;
  chainType?: 'ethereum' | 'solana' | 'bitcoin';
  walletClient?: string;
  // Base Account specific fields
  isBaseAccount?: boolean;
  isEmbeddedWallet?: boolean;
  // External wallet indicator - true when connected via injected wallet (MetaMask, etc.)
  isExternalWallet?: boolean;
  // Methods for wallet interactions
  getEthereumProvider?: () => any;
  switchChain?: (chainId: number) => Promise<void>;
}

// User data from Base/CDP auth - replaces Privy user object
interface BaseUser {
  id: string; // wallet address as ID
  email?: string;
  wallet?: {
    address: string;
  };
}

interface UserData {
  baseUser: BaseUser | null; // Renamed from privyUser
  profile: UserProfile | null;
  entryCount: number;
  walletBalance: number;
  linkedWallets: LinkedWallet[];
  isLoading: boolean;
  // Base Account state for Sub Account integration
  baseAccount: LinkedWallet | null;
  embeddedWallet: LinkedWallet | null;
  // Auth state
  authenticated: boolean;
  ready: boolean;
  // Logout function
  logout: () => Promise<void>;
}

// Pre-auth state machine to track authentication flow stages
// This prevents premature database queries when baseUser.id is not yet available
type PreAuthState = 
  | 'unauthenticated'        // No auth in progress
  | 'awaitingBaseAuthCompletion' // Base auth in progress, wallet connecting
  | 'authenticated';          // Fully authenticated with baseUser.id available

interface AuthContextType extends UserData {
  refreshUserData: () => Promise<void>;
  // Keep privyUser for backward compatibility (maps to baseUser)
  privyUser: BaseUser | null;
  // Canonical user ID in prize:pid: format for Supabase calls
  canonicalUserId: string | null;
  // Login function - triggers auth modal via event system
  // Components call this, and the Header component listens and opens the modal
  login: (options?: { loginMethods?: string[]; prefill?: { type: string; value: string } }) => void;
  // Pre-auth state for tracking flow stages
  preAuthState: PreAuthState;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Grace period after auth-complete event to prevent redundant refreshUserData calls
// This prevents a race condition where handleAuthStateChange tries to refresh without email
// Increased to 5 seconds to account for slow mobile networks and async operations
const AUTH_COMPLETE_GRACE_PERIOD_MS = 5000;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // CDP/Base hooks for authentication - replaces Privy
  const { currentUser } = useCurrentUser();
  const { isSignedIn } = useIsSignedIn();
  const { evmAddress } = useEvmAddress();
  const { signOut } = useSignOut();

  // Wagmi hooks for external wallet connections (Base App, Coinbase Wallet, etc.)
  const { address: wagmiAddress, isConnected: wagmiIsConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [walletBalance, setWalletBalance] = useState(0);
  const [linkedWallets, setLinkedWallets] = useState<LinkedWallet[]>([]);
  const [baseAccount, setBaseAccount] = useState<LinkedWallet | null>(null);
  const [embeddedWallet, setEmbeddedWallet] = useState<LinkedWallet | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [ready, setReady] = useState(false);
  
  // Pre-auth state machine - tracks authentication flow stages
  // This prevents premature database queries before baseUser.id is available
  const [preAuthState, setPreAuthState] = useState<PreAuthState>('unauthenticated');

  // Track if initial auth data has been fetched to prevent infinite loops
  const initialFetchDoneRef = useRef(false);
  const lastFetchedUserIdRef = useRef<string | null>(null);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if a refresh is currently in progress to prevent concurrent refreshes
  const refreshInProgressRef = useRef(false);
  // Track when auth-complete event was handled to prevent race condition with handleAuthStateChange
  const authCompleteHandledRef = useRef<number>(0);
  // Store the email from the auth-complete event to use in case of race conditions
  const lastAuthCompleteEmailRef = useRef<string | null>(null);

  // Extract email from currentUser (memoized to prevent unnecessary recalculations)
  const userEmail = (currentUser as any)?.email || (currentUser as any)?.emails?.[0]?.value || (currentUser as any)?.emails?.[0]?.address;

  // Determine the effective wallet address
  // CDP (email sign-in) takes priority over wagmi (external wallet connection)
  // This prevents conflicts when a CDP user also has an external wallet connected
  // If the user is signed in via CDP, we always use the CDP wallet address
  // regardless of whether wagmi has a connected wallet
  const isCDPAuthenticated = isSignedIn && !!evmAddress;
  const effectiveWalletAddress = isCDPAuthenticated ? evmAddress : wagmiAddress;

  // DIAGNOSTIC: Log wallet address resolution for debugging
  useEffect(() => {
    if (effectiveWalletAddress) {
      const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS?.toLowerCase();
      console.log('[AuthContext] Wallet address diagnostic:', {
        effectiveWalletAddress,
        evmAddress,
        wagmiAddress,
        isCDPAuthenticated,
        isSignedIn,
        wagmiIsConnected,
        source: isCDPAuthenticated ? 'CDP (evmAddress)' : wagmiAddress ? 'Wagmi (external wallet)' : 'Unknown',
        treasuryAddress,
        isTreasuryAddress: effectiveWalletAddress.toLowerCase() === treasuryAddress,
        userEmail,
        currentUserId: currentUser?.userId,
        localStorage_cdp_wallet: localStorage.getItem('cdp:wallet_address'),
        localStorage_base_wallet: localStorage.getItem('base:wallet_address'),
        timestamp: new Date().toISOString()
      });

      // CRITICAL: Alert if treasury address is detected
      if (treasuryAddress && effectiveWalletAddress.toLowerCase() === treasuryAddress) {
        console.error('[AuthContext] ⚠️  CRITICAL: Treasury address detected as user wallet!');
        console.error('[AuthContext] Treasury:', treasuryAddress);
        console.error('[AuthContext] User wallet:', effectiveWalletAddress);
        console.error('[AuthContext] Source:', isCDPAuthenticated ? 'CDP' : 'Wagmi');
      }
    }
  }, [effectiveWalletAddress, evmAddress, wagmiAddress, isCDPAuthenticated, isSignedIn, wagmiIsConnected, userEmail, currentUser]);

  // Create a BaseUser object from CDP data or wagmi data - memoized to prevent infinite re-renders
  // This was causing an infinite loop because a new object was created on every render,
  // triggering the useEffect that depends on baseUser, which called refreshUserData,
  // which updated state, causing another render, and so on.
  const baseUser: BaseUser | null = useMemo(() => {
    if (!effectiveWalletAddress) return null;
    return {
      id: effectiveWalletAddress, // Use wallet address as the primary ID
      email: userEmail,
      wallet: { address: effectiveWalletAddress },
    };
  }, [effectiveWalletAddress, userEmail]);

  // Determine if user is authenticated
  // CDP authentication takes priority - if signed in via CDP, ignore wagmi state
  // This prevents confusing states where the profile is for one wallet but UI shows another
  const authenticated = isCDPAuthenticated || (wagmiIsConnected && !!wagmiAddress && !isCDPAuthenticated);

  // Update preAuthState based on authentication status
  // This state machine helps components understand where in the auth flow we are
  useEffect(() => {
    const newState: PreAuthState = authenticated && baseUser?.id 
      ? 'authenticated' 
      : authenticated && !baseUser?.id 
        ? 'awaitingBaseAuthCompletion' 
        : 'unauthenticated';
    
    if (newState !== preAuthState) {
      console.log('[AuthContext] PreAuthState transition:', preAuthState, '->', newState, {
        authenticated,
        hasBaseUserId: !!baseUser?.id,
        effectiveWalletAddress,
        timestamp: new Date().toISOString()
      });
      setPreAuthState(newState);
    }
  }, [authenticated, baseUser?.id, effectiveWalletAddress, preAuthState]);

  // Mark as ready once CDP has finished initializing or wagmi is connected
  // Use smart session restoration detection to minimize flash of logged-out state
  useEffect(() => {
    // If already signed in with wallet (CDP or wagmi), mark ready immediately
    if ((isSignedIn && evmAddress) || (wagmiIsConnected && wagmiAddress)) {
      setReady(true);
      return;
    }

    // CDP is ready when isSignedIn is defined (not just truthy)
    if (typeof isSignedIn === 'boolean') {
      // Check if there was a previous session that might need restoration
      // This allows us to avoid the timeout for truly new/logged-out users
      const hadPreviousSession = localStorage.getItem('cdp:wallet_address') ||
                                  localStorage.getItem('base:wallet_address');

      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
      }

      if (!hadPreviousSession) {
        // No previous session - user was never logged in or logged out properly
        // Mark ready immediately to avoid unnecessary delay
        setReady(true);
        return;
      }

      // Had a previous session - wait briefly for CDP to restore it
      // Use a shorter timeout (200ms) since we're only waiting for SDK initialization
      // If session restoration takes longer, the auth state will update and trigger re-render
      readyTimeoutRef.current = setTimeout(() => {
        setReady(true);
      }, 200);

      return () => {
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current);
        }
      };
    }

    // CRITICAL FIX: If CDP SDK hasn't initialized after 1 second, mark ready anyway
    // This prevents the login button from being permanently disabled if the SDK
    // fails to initialize or takes too long. Without this, isSignedIn could stay
    // undefined and the button would never work.
    if (readyTimeoutRef.current) {
      clearTimeout(readyTimeoutRef.current);
    }
    readyTimeoutRef.current = setTimeout(() => {
      console.log('[AuthContext] CDP SDK did not initialize in time, marking ready anyway');
      setReady(true);
    }, 1000);

    return () => {
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
      }
    };
  }, [isSignedIn, evmAddress, wagmiIsConnected, wagmiAddress]);

  // Logout function using CDP and/or wagmi
  const logout = useCallback(async () => {
    try {
      console.log('[AuthContext] Logout initiated');
      
      // Reset pre-auth state
      setPreAuthState('unauthenticated');
      
      // Disconnect wagmi wallet if connected
      if (wagmiIsConnected) {
        wagmiDisconnect();
      }
      // Sign out of CDP if signed in
      if (isSignedIn) {
        await signOut();
      }
      // Clear only app-specific localStorage keys instead of clearing everything
      // This preserves CDP/wagmi session data needed for re-authentication
      // and prevents destroying unrelated data from other parts of the app
      const keysToRemove = [
        'cdp:wallet_address',
        'base:wallet_address',
        'user_profile_cache',
        'last_competition_view',
      ];
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // Clear cached avatar to prevent stale avatar on re-login
      userDataService.clearCachedAvatarUrl();

      // Clear sessionStorage app data but preserve SDK session data
      sessionStorage.removeItem('payment_in_progress');
      sessionStorage.removeItem('ticket_selection');

      window.location.href = window.location.origin + '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  }, [signOut, wagmiIsConnected, wagmiDisconnect, isSignedIn]);

  // Login function - dispatches a custom event that the Header component listens to
  // This allows components to trigger the auth modal without directly importing it
  const login = useCallback((options?: { loginMethods?: string[]; prefill?: { type: string; value: string } }) => {
    console.log('[AuthContext] Login triggered', options);
    // Dispatch a custom event that the Header component will listen for
    const event = new CustomEvent('open-auth-modal', { detail: options });
    window.dispatchEvent(event);
  }, []);

  const fetchUserData = useCallback(async (userId: string, walletAddress?: string, options?: { skipBalance?: boolean }) => {
    try {
      const inputIdentifier = userId || walletAddress || '';
      // Convert to canonical format for consistency
      const canonicalId = toPrizePid(inputIdentifier);

      const { data: entryData } = await supabase
        .rpc('get_user_active_tickets', { p_user_identifier: canonicalId }) as any;

      setEntryCount(Number(entryData) || 0);

      // Only fetch balance if not skipped - this prevents overwriting balance
      // from a recent payment with stale data due to database replication lag
      if (!options?.skipBalance) {
        const { data: balanceData } = await supabase
          .rpc('get_user_wallet_balance', { p_user_identifier: canonicalId }) as any;
        setWalletBalance(Number(balanceData) || 0);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      setEntryCount(0);
      if (!options?.skipBalance) {
        setWalletBalance(0);
      }
    }
  }, []);

  const extractLinkedWallets = (walletAddress: string | undefined, isFromCDP: boolean): { wallets: LinkedWallet[], baseAccount: LinkedWallet | null, embeddedWallet: LinkedWallet | null } => {
    if (!walletAddress) return { wallets: [], baseAccount: null, embeddedWallet: null };

    // Determine if this is an embedded CDP wallet or an external wallet (MetaMask, etc.)
    // CDP wallets are created via email sign-in, external wallets connect via wagmi injected connector
    if (isFromCDP) {
      // This is a CDP-created embedded Base wallet
      const baseWallet: LinkedWallet = {
        address: walletAddress,
        type: 'base_account',
        chainType: 'ethereum',
        walletClient: 'base_account',
        isBaseAccount: true,
        isEmbeddedWallet: true,
        isExternalWallet: false,
      };

      return {
        wallets: [baseWallet],
        baseAccount: baseWallet,
        embeddedWallet: baseWallet,
      };
    } else {
      // This is an external wallet connected via wagmi (MetaMask, Coinbase Wallet app, etc.)
      const externalWallet: LinkedWallet = {
        address: walletAddress,
        type: 'external_wallet',
        chainType: 'ethereum',
        walletClient: 'external', // Could be MetaMask, Coinbase Wallet, etc.
        isBaseAccount: false,
        isEmbeddedWallet: false,
        isExternalWallet: true,
      };

      return {
        wallets: [externalWallet],
        baseAccount: null,
        embeddedWallet: null,
      };
    }
  };

  const refreshUserData = useCallback(async (overrideEmail?: string) => {
    if (!effectiveWalletAddress) return;

    // Guard against concurrent refresh calls - prevents race conditions
    if (refreshInProgressRef.current) {
      console.log('[AuthContext] Refresh already in progress, skipping');
      return;
    }

    refreshInProgressRef.current = true;
    setIsLoading(true);
    try {
      // Store wallet address in localStorage for payment auth flow
      // This is used by base-payment.ts to get auth token
      localStorage.setItem('cdp:wallet_address', effectiveWalletAddress);

      // Determine if this is a CDP embedded wallet or an external wallet
      // Use the stored isCDPAuthenticated flag which considers both isSignedIn and evmAddress
      const isFromCDP = isCDPAuthenticated;

      // CRITICAL FIX: Use email priority order:
      // 1. Override email from function parameter (most reliable - from auth-complete event)
      // 2. Email from last auth-complete event (stored in ref)
      // 3. Current user email from CDP hooks
      // This ensures we always have the best available email for user lookup
      const effectiveEmail = overrideEmail || lastAuthCompleteEmailRef.current || userEmail;

      console.log('[AuthContext] refreshUserData called with:', {
        effectiveWalletAddress,
        effectiveEmail,
        overrideEmail,
        lastAuthCompleteEmail: lastAuthCompleteEmailRef.current,
        userEmail,
        source: overrideEmail ? 'auth-complete event' : (lastAuthCompleteEmailRef.current ? 'stored auth-complete email' : 'currentUser')
      });

      // Create a user object compatible with the existing getOrCreateUser function
      const walletClientType = isFromCDP ? 'base_account' : 'external';
      const userForAuth = {
        id: effectiveWalletAddress, // Use wallet address as the primary identifier
        email: { address: effectiveEmail },
        wallet: { address: effectiveWalletAddress },
        linkedAccounts: effectiveEmail ? [
          { type: 'email', address: effectiveEmail },
          { type: 'wallet', address: effectiveWalletAddress, walletClientType },
        ] : [
          { type: 'wallet', address: effectiveWalletAddress, walletClientType },
        ],
      };

      const userProfile = await userAuth.getOrCreateUser(userForAuth);
      console.log('[AuthContext] User profile loaded:', {
        email: userProfile?.email,
        id: userProfile?.id,
        wallet_address: userProfile?.wallet_address,
        isFromCDP,
      });
      setProfile(userProfile);

      // CRITICAL: Call upsert_canonical_user RPC after auth sign-in/signup
      // This ensures canonical_users table is up-to-date with auth data
      // Uses retry logic to handle transient failures
      if (userProfile) {
        try {
          console.log('[AuthContext] Calling upsert_canonical_user RPC after auth');
          const canonicalUserId = toPrizePid(effectiveWalletAddress);
          
          // Use retry logic for robustness
          const result = await withRetry(
            async () => {
              // NOTE: Parameters must match the database function signature exactly:
              // p_uid, p_canonical_user_id, p_email, p_username, p_wallet_address,
              // p_base_wallet_address, p_eth_wallet_address, p_privy_user_id,
              // p_first_name, p_last_name, p_telegram_handle, p_wallet_linked
              return await supabase.rpc('upsert_canonical_user', {
                p_uid: userProfile.uid || userProfile.id,
                p_canonical_user_id: canonicalUserId,
                p_email: effectiveEmail || null,
                p_username: userProfile.username || effectiveEmail?.split('@')[0] || null,
                p_wallet_address: effectiveWalletAddress.toLowerCase(),
                p_base_wallet_address: effectiveWalletAddress.toLowerCase(),
                p_eth_wallet_address: effectiveWalletAddress.toLowerCase(),
                p_privy_user_id: effectiveWalletAddress,
                p_first_name: userProfile.first_name || null,
                p_last_name: userProfile.last_name || null,
                p_telegram_handle: userProfile.telegram_handle || null,
                p_wallet_linked: false, // Not a wallet link event, just auth
              });
            },
            {
              maxRetries: 3,
              delayMs: 1000,
              context: 'upsert_canonical_user',
              shouldRetry: (error) => {
                // Retry on network errors or temporary database issues
                // Handle both Error objects and raw error messages
                const errorMsg = error instanceof Error ? error.message : String(error);
                const errorObj = error as any;
                
                return errorMsg.includes('network') || 
                       errorMsg.includes('timeout') ||
                       errorMsg.includes('ECONNRESET') ||
                       errorMsg.includes('Failed to send') ||
                       errorMsg.includes('FunctionsFetchError') ||
                       errorObj?.code === 'ETIMEDOUT' ||
                       errorObj?.code === 'ECONNRESET';
              }
            }
          );

          const { data: rpcData, error: rpcError } = result;

          if (rpcError) {
            console.error('[AuthContext] upsert_canonical_user RPC failed after retries:', rpcError);
            // Don't block the user - log error but continue
          } else if (rpcData?.success === false) {
            console.error('[AuthContext] upsert_canonical_user returned failure:', rpcData.error);
          } else {
            console.log('[AuthContext] upsert_canonical_user RPC success:', {
              user_id: rpcData?.user_id,
              is_new_user: rpcData?.is_new_user,
              wallet_linked: rpcData?.wallet_linked
            });

            // Send welcome email for new users
            // The RPC returns { success: true, is_new_user: boolean, ... }
            if (rpcData && typeof rpcData === 'object' && 'is_new_user' in rpcData && rpcData.is_new_user === true) {
              console.log('[AuthContext] New user detected, sending welcome email');
              const emailToSend = effectiveEmail || userProfile.email;
              const usernameToSend = userProfile.username || effectiveEmail?.split('@')[0] || 'Player';

              if (emailToSend) {
                try {
                  const emailResponse = await fetch('/api/send-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      type: 'welcome',
                      to: emailToSend,
                      templateData: { username: usernameToSend },
                    }),
                  });

                  if (emailResponse.ok) {
                    console.log('[AuthContext] Welcome email sent successfully to:', emailToSend);
                  } else {
                    console.warn('[AuthContext] Welcome email failed:', await emailResponse.text());
                  }
                } catch (emailErr) {
                  console.warn('[AuthContext] Welcome email error (non-blocking):', emailErr);
                }
              } else {
                console.log('[AuthContext] No email available for welcome email');
              }
            }
          }
        } catch (rpcErr) {
          console.error('[AuthContext] upsert_canonical_user RPC exception:', rpcErr);
          // Don't block user experience - log and continue
        }
      }

      // Extract linked wallets - distinguish between CDP embedded wallets and external wallets
      const { wallets, baseAccount: detectedBase, embeddedWallet: detectedEmbedded } = extractLinkedWallets(effectiveWalletAddress, isFromCDP);
      setLinkedWallets(wallets);
      setBaseAccount(detectedBase);
      setEmbeddedWallet(detectedEmbedded);

      if (userProfile) {
        // Use wallet address as the primary identifier for Base auth
        await fetchUserData(
          effectiveWalletAddress,
          userProfile.wallet_address || undefined
        );
      }
    } catch (error) {
      console.error('Error refreshing user data:', error);
    } finally {
      refreshInProgressRef.current = false;
      setIsLoading(false);
    }
  }, [effectiveWalletAddress, userEmail, fetchUserData, isCDPAuthenticated]);

  useEffect(() => {
    const handleAuthStateChange = async () => {
      if (ready && authenticated && effectiveWalletAddress) {
        // Only fetch if we haven't already fetched for this user
        // This prevents infinite loops when the effect dependencies change
        if (lastFetchedUserIdRef.current === effectiveWalletAddress && initialFetchDoneRef.current) {
          return;
        }

        // CRITICAL FIX: If auth-complete event was handled in the last 2 seconds, skip this call
        // The auth-complete handler already called refreshUserData with the correct email
        // This prevents a race condition where this effect calls refreshUserData without email
        const timeSinceAuthComplete = Date.now() - authCompleteHandledRef.current;
        if (timeSinceAuthComplete < AUTH_COMPLETE_GRACE_PERIOD_MS) {
          console.log('[AuthContext] Auth-complete event was just handled, skipping redundant refresh from handleAuthStateChange');
          // Still mark as fetched so we don't trigger again
          lastFetchedUserIdRef.current = effectiveWalletAddress;
          initialFetchDoneRef.current = true;
          return;
        }

        console.log('Auth state: User authenticated via Base, fetching data for:', effectiveWalletAddress);
        lastFetchedUserIdRef.current = effectiveWalletAddress;
        initialFetchDoneRef.current = true;
        setIsLoading(true);
        void refreshUserData();
      } else if (ready && !authenticated) {
        console.log('Auth state: User not authenticated, clearing data');
        // Reset tracking refs when user logs out
        initialFetchDoneRef.current = false;
        lastFetchedUserIdRef.current = null;
        authCompleteHandledRef.current = 0;
        lastAuthCompleteEmailRef.current = null; // Clear stored email
        setProfile(null);
        setEntryCount(0);
        setWalletBalance(0);
        setLinkedWallets([]);
        setBaseAccount(null);
        setEmbeddedWallet(null);
        setIsLoading(false);
      }
    };

    void handleAuthStateChange();
  }, [ready, authenticated, effectiveWalletAddress, refreshUserData]);

  useEffect(() => {
    if (!profile?.uid && !profile?.wallet_address && !baseUser?.id) return;

    // Wallet address is the PRIMARY identifier for Base auth
    const walletId = baseUser?.id || '';
    const legacyIdentifier = profile?.uid || profile?.id || profile?.wallet_address || '';

    // Normalize wallet address to lowercase for case-insensitive comparison
    const isWalletAddress = walletId.startsWith('0x') && walletId.length === 42;
    const normalizedWalletId = isWalletAddress ? walletId.toLowerCase() : walletId;

    // Helper function for case-insensitive matching across multiple columns
    const recordMatchesUser = (record: { wallet_address?: string; privy_user_id?: string; userid?: string }) => {
      // Case-insensitive wallet address comparison
      const matchesWallet = record.wallet_address?.toLowerCase() === normalizedWalletId;
      // Check privy_user_id - could be a Privy DID or wallet address
      const matchesPrivyId = record.privy_user_id === walletId ||
                             record.privy_user_id?.toLowerCase() === normalizedWalletId;
      // Check legacy userid
      const matchesUserId = record.userid === legacyIdentifier ||
                            record.userid?.toLowerCase() === normalizedWalletId;
      return matchesWallet || matchesPrivyId || matchesUserId;
    };

    // Subscribe to entries without filter and apply case-insensitive matching in callback
    // Supabase real-time filters are case-sensitive, so we need client-side filtering
    const channel = supabase
      .channel('user_data_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'joincompetition',
        },
        (payload) => {
          // Use helper function for robust case-insensitive matching
          const record = payload.new as {
            wallet_address?: string;
            privy_user_id?: string;
            userid?: string;
          };

          if (recordMatchesUser(record)) {
            void fetchUserData(profile?.uid || profile?.id || '', profile?.wallet_address || undefined);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.uid, profile?.wallet_address, baseUser?.id, fetchUserData]);

  // Listen for auth-complete event from BaseWalletAuthModal
  // This ensures user data is refreshed immediately after authentication
  useEffect(() => {
    const handleAuthComplete = (event: CustomEvent) => {
      console.log('[AuthContext] ✅ Auth complete event received:', {
        detail: event.detail,
        hasWalletAddress: !!event.detail?.walletAddress,
        hasEmail: !!event.detail?.email,
        effectiveWalletAddress,
        currentPreAuthState: preAuthState,
        timestamp: new Date().toISOString()
      });
      
      // Update pre-auth state to indicate Base auth is completing
      setPreAuthState('awaitingBaseAuthCompletion');
      
      // CRITICAL FIX: Mark that auth-complete was handled to prevent race with handleAuthStateChange
      authCompleteHandledRef.current = Date.now();
      // Store the email from the event for use in case of race conditions
      if (event.detail?.email) {
        lastAuthCompleteEmailRef.current = event.detail.email;
        console.log('[AuthContext] Stored email from auth-complete event:', event.detail.email);
      }
      // Reset tracking refs to force a fresh fetch
      initialFetchDoneRef.current = false;
      lastFetchedUserIdRef.current = null;
      // Trigger refresh if we have a wallet address
      // CRITICAL FIX: Pass the email from the event detail to refreshUserData
      // This ensures we can find the existing user by email even if currentUser.email is not yet populated
      // Note: void is used to explicitly ignore the promise. Error handling is done within refreshUserData.
      if (event.detail?.walletAddress || effectiveWalletAddress) {
        console.log('[AuthContext] Triggering refreshUserData after auth-complete');
        void refreshUserData(event.detail?.email);
      } else {
        console.warn('[AuthContext] No wallet address available in auth-complete event or effectiveWalletAddress');
      }
    };

    // Listen for balance updates from PaymentModal
    const handleBalanceUpdated = (event: CustomEvent<{ newBalance?: number }>) => {
      console.log('[AuthContext] Balance updated event received:', event.detail);

      // CRITICAL FIX: Use the balance value from the event if provided
      // This avoids stale data from RPC queries due to database replication lag
      // The server returns the correct balance immediately after debit
      if (event.detail?.newBalance !== undefined && event.detail.newBalance !== null) {
        console.log('[AuthContext] Using balance from event:', event.detail.newBalance);
        setWalletBalance(event.detail.newBalance);
      }

      // Refresh other user data (entries, profile, etc.) but SKIP balance fetch
      // The balance is already set from the event above - don't let the RPC
      // overwrite it with potentially stale data due to database replication lag
      if (profile?.uid || profile?.id || profile?.wallet_address) {
        fetchUserData(
          profile?.uid || profile?.id || '',
          profile?.wallet_address || undefined,
          { skipBalance: true } // CRITICAL: Skip balance to avoid overwriting with stale data
        );
      }
    };

    window.addEventListener('auth-complete', handleAuthComplete as EventListener);
    window.addEventListener('balance-updated', handleBalanceUpdated as EventListener);
    return () => {
      window.removeEventListener('auth-complete', handleAuthComplete as EventListener);
      window.removeEventListener('balance-updated', handleBalanceUpdated as EventListener);
    };
  }, [effectiveWalletAddress, refreshUserData, fetchUserData, profile?.wallet_address, profile?.id, profile?.uid]);

  // Compute canonical user ID for Supabase calls
  // This is the ONLY acceptable identifier for database queries and RPC calls
  const canonicalUserId = useMemo(() => {
    if (!baseUser?.id) {
      console.warn('[AuthContext] No baseUser.id available, canonicalUserId will be null');
      return null;
    }
    
    const canonical = toCanonicalUserId(baseUser.id);
    console.log('[AuthContext] Canonical user ID:', canonical, 'from baseUser.id:', baseUser.id);
    return canonical;
  }, [baseUser?.id]);

  const value: AuthContextType = {
    baseUser,
    privyUser: baseUser, // Keep privyUser for backward compatibility
    canonicalUserId,
    profile,
    entryCount,
    walletBalance,
    linkedWallets,
    isLoading,
    baseAccount,
    embeddedWallet,
    authenticated,
    ready,
    logout,
    login,
    refreshUserData,
    preAuthState, // Expose pre-auth state for components to check
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Allow exporting the helper hook from the same file as the provider component
// eslint-disable-next-line react-refresh/only-export-components
export const useAuthUser = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // Return default values when provider is not available
    // This allows the app to work without auth configured
    return {
      baseUser: null,
      privyUser: null,
      canonicalUserId: null,
      profile: null,
      entryCount: 0,
      walletBalance: 0,
      linkedWallets: [],
      isLoading: false,
      baseAccount: null,
      embeddedWallet: null,
      authenticated: false,
      ready: false,
      logout: async () => {},
      login: () => {
        console.warn('[AuthContext] Login called but AuthProvider is not available');
      },
      refreshUserData: async () => {},
      preAuthState: 'unauthenticated',
    };
  }
  return context;
};