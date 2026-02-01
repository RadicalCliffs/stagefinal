import { supabase } from '../lib/supabase';
import { toPrizePid, isPrizePid } from '../utils/userId';
import { VALID_AVATAR_FILENAMES, SUPABASE_AVATAR_BASE_URL, getAvatarUrl, getRandomAvatarUrl } from '../lib/avatarConstants';
import { parseBalanceResponse } from '../utils/balanceParser';

export interface UserDataAggregation {
  totalTickets: number;
  activeTickets: number;
  walletBalance: number;
  recentEntries: number;
}

export interface AvatarOption {
  name: string;
  url: string;
  isDefault: boolean;
  isGenerated?: boolean;
}

// Cache key for persisting avatar URL across page navigations
const AVATAR_CACHE_KEY = 'user_avatar_cache';

export const userDataService = {
  // Get avatar URL from Supabase storage - using the shared constants module
  getAvatarUrl(avatarFileName: string): string {
    return getAvatarUrl(avatarFileName);
  },

  // Cache the avatar URL to localStorage to prevent visual swapping during navigation
  // This ensures the avatar persists across page transitions while profile data reloads
  cacheAvatarUrl(avatarUrl: string): void {
    if (typeof window !== 'undefined' && avatarUrl) {
      try {
        localStorage.setItem(AVATAR_CACHE_KEY, avatarUrl);
      } catch (e) {
        // Ignore localStorage errors (e.g., in incognito mode)
      }
    }
  },

  // Get the cached avatar URL from localStorage
  // Returns null if no cached avatar exists
  getCachedAvatarUrl(): string | null {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem(AVATAR_CACHE_KEY);
      } catch (e) {
        // Ignore localStorage errors
        return null;
      }
    }
    return null;
  },

  // Clear the cached avatar (e.g., on logout)
  clearCachedAvatarUrl(): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(AVATAR_CACHE_KEY);
      } catch (e) {
        // Ignore localStorage errors
      }
    }
  },

  // Get a consistent default avatar for a user
  // Uses the first avatar as the default to prevent random changes on every page load
  // If you want a random avatar assigned once, call getRandomAvatar() during account creation only
  getDefaultAvatar(): string {
    // Return a consistent default avatar - the first one in the list
    return this.getAvatarUrl(VALID_AVATAR_FILENAMES[0]);
  },

  // Get a random avatar - should only be called ONCE during account creation
  // Do NOT use this for getting current avatar display
  getRandomAvatar(): string {
    return getRandomAvatarUrl();
  },

  // Get all available avatars for selection - using the 777btc avatars
  getAllAvatars(): AvatarOption[] {
    return VALID_AVATAR_FILENAMES.map((filename, index) => ({
      name: filename,
      url: this.getAvatarUrl(filename),
      isDefault: index < 5, // First 5 are considered "default"
      isGenerated: false,
    }));
  },

  // Get all avatars (alias for getAllAvatars for backwards compatibility)
  getGeneratedAvatars(): AvatarOption[] {
    return this.getAllAvatars();
  },

  // Validate user identifier format
  // Supports:
  // - Canonical prize:pid: format (PRIMARY)
  // - Wallet addresses (0x followed by 40 hex chars)
  // - Legacy Privy DIDs (did:privy:xxxxx format)
  isValidUserIdentifier(identifier: string): boolean {
    if (!identifier || typeof identifier !== 'string') {
      return false;
    }
    // Canonical prize:pid: format
    if (isPrizePid(identifier)) {
      return true;
    }
    // Wallet address format: 0x followed by 40 hexadecimal characters (case-insensitive)
    const walletRegex = /^0x[a-fA-F0-9]{40}$/;
    // Legacy DID format: did:privy:xxxxx where xxxxx is an alphanumeric string
    const didRegex = /^did:privy:[a-zA-Z0-9]+$/;
    return walletRegex.test(identifier) || didRegex.test(identifier);
  },

  // Check if identifier is a wallet address
  isWalletAddress(identifier: string): boolean {
    if (!identifier || typeof identifier !== 'string') {
      return false;
    }
    const walletRegex = /^0x[a-fA-F0-9]{40}$/;
    return walletRegex.test(identifier);
  },

  // Legacy alias - kept for backward compatibility
  isValidDID(did: string): boolean {
    return this.isValidUserIdentifier(did);
  },

  // Update user avatar in the database using RPC function
  // This uses a SECURITY DEFINER function to bypass RLS
  // Supports wallet addresses, canonical prize:pid:, and legacy Privy DIDs
  async updateUserAvatar(userId: string, avatarUrl: string): Promise<boolean> {
    try {
      // Convert to canonical format
      const canonicalUserId = toPrizePid(userId);
      console.log('[userDataService] Updating avatar for user:', canonicalUserId);

      // Validate user identifier format
      if (!this.isValidUserIdentifier(userId) && !isPrizePid(userId)) {
        console.error('[userDataService] Invalid user identifier format:', userId);
        return false;
      }

      // Use RPC function to bypass RLS - handles case-insensitive matching
      const { data, error } = await (supabase.rpc as any)('update_user_avatar', {
        user_identifier: canonicalUserId,
        new_avatar_url: avatarUrl
      });

      if (error) {
        console.error('[userDataService] Error updating user avatar:', error);
        return false;
      }

      // Check the result from the RPC function
      if (data && typeof data === 'object' && 'success' in data) {
        const typedData = data as { success?: boolean; error?: string };
        if (typedData.success) {
          console.log('[userDataService] Avatar updated successfully:', data);
          return true;
        } else {
          console.error('[userDataService] Avatar update failed:', typedData.error);
          return false;
        }
      }

      // CRITICAL FIX: Don't assume success if response doesn't have explicit success field
      // The RPC might return empty data or an unexpected format
      console.warn('[userDataService] Avatar update returned no success confirmation:', data);
      return false; // Changed from true to false - require explicit success
    } catch (error) {
      console.error('[userDataService] Error in updateUserAvatar:', error);
      return false;
    }
  },

  async getUserAggregatedData(
    userId: string,
    walletAddress?: string
  ): Promise<UserDataAggregation> {
    const inputIdentifier = userId || walletAddress || '';
    // Convert to canonical format
    const canonicalId = toPrizePid(inputIdentifier);
    // Normalize wallet for case-insensitive matching
    const normalizedWallet = this.isWalletAddress(inputIdentifier) ? inputIdentifier.toLowerCase() : inputIdentifier;

    try {
      // Get user tickets using direct query (staging compatible, no bypass_rls)
      let tickets: any[] = [];
      try {
        // First try the standard RPC (if EXECUTE granted to anon)
        const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
          'get_user_tickets', 
          { user_identifier: canonicalId }
        );

        if (!rpcError && rpcData) {
          tickets = rpcData;
        } else {
          // Fallback: Direct query to joincompetition table
          // Note: Using v_joincompetition_active view for stable read interface
          // Supabase client library handles parameter escaping to prevent SQL injection
          console.log('[userDataService] get_user_tickets RPC unavailable, using direct query');
          const { data: directData, error: directError } = await supabase
            .from('v_joincompetition_active')
            .select('*')
            .or(`wallet_address.ilike.${normalizedWallet},userid.eq.${canonicalId}`)
            .order('purchasedate', { ascending: false });

          if (!directError && directData) {
            tickets = directData;
          } else if (directError) {
            console.error('Error fetching user tickets (direct):', directError);
          }
        }
      } catch (ticketsErr) {
        console.error('Error fetching user tickets:', ticketsErr);
      }

      // Get user balance using get_user_balance RPC for consistent lookups
      const { data: rpcBalance, error: rpcError } = await (supabase.rpc as any)('get_user_balance', {
        p_canonical_user_id: canonicalId
      });

      // Check for type mismatch error (can occur if database migration not applied)
      const isTypeMismatchError = rpcError?.message?.includes('operator does not exist') ||
        rpcError?.message?.includes('type cast') ||
        rpcError?.code === '42883' ||
        rpcError?.code === '42846';

      let walletBalance = 0;
      if (!rpcError && rpcBalance !== null) {
        // get_user_balance returns JSONB object: { success, balance, bonus_balance, total_balance }
        const balanceData = parseBalanceResponse(rpcBalance);
        walletBalance = balanceData.balance;
      } else {
        if (isTypeMismatchError) {
          console.warn('[userDataService] RPC type mismatch error - database migration may need to be applied. Falling back to direct query.');
        }
        // Fallback: Direct query to wallet_balances view
        const { data: userBalance, error: balanceError } = await supabase
          .from('wallet_balances')
          .select('balance')
          .eq('canonical_user_id', canonicalId)
          .single<{ balance?: number | null }>();

        if (balanceError) {
          console.error('Error fetching user balance:', balanceError);
        }
        walletBalance = Number(userBalance?.balance || 0);
      }

      // Get recent entries count - use direct query instead of bypass_rls
      let recentEntries = 0;
      try {
        // First try standard RPC (if available)
        const { data: rpcRecentData, error: rpcRecentError } = await (supabase.rpc as any)(
          'get_recent_entries_count', 
          { user_identifier: canonicalId }
        );

        if (!rpcRecentError && rpcRecentData !== null) {
          recentEntries = Number(rpcRecentData || 0);
        } else {
          // Fallback: Direct count query on joincompetition
          console.log('[userDataService] get_recent_entries_count RPC unavailable, using direct count');
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          // Note: Using v_joincompetition_active view for stable read interface
          // Supabase client library handles parameter escaping to prevent SQL injection
          const { count, error: countError } = await supabase
            .from('v_joincompetition_active')
            .select('*', { count: 'exact', head: true })
            .or(`wallet_address.ilike.${normalizedWallet},userid.eq.${canonicalId}`)
            .gte('purchasedate', thirtyDaysAgo.toISOString());

          if (!countError) {
            recentEntries = count || 0;
          }
        }
      } catch (recentErr) {
        console.error('Error fetching recent entries count:', recentErr);
      }

      // Calculate aggregation
      const ticketsData = tickets || [];
      const totalTickets = ticketsData.length;
      const activeTickets = ticketsData.filter((t: any) => t.is_active !== false).length;

      return {
        totalTickets,
        activeTickets,
        walletBalance,
        recentEntries
      };
    } catch (error) {
      console.error('Error in getUserAggregatedData:', error);
      return {
        totalTickets: 0,
        activeTickets: 0,
        walletBalance: 0,
        recentEntries: 0
      };
    }
  },

  // Helper method to get user tickets count
  async getUserTicketCount(userId: string): Promise<number> {
    try {
      const canonicalId = toPrizePid(userId);
      const normalizedWallet = this.isWalletAddress(userId) ? userId.toLowerCase() : userId;

      // Try standard RPC first
      const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
        'get_user_tickets', 
        { user_identifier: canonicalId }
      );

      if (!rpcError && rpcData) {
        const typedData = rpcData as any[];
        return typedData.length || 0;
      }

      // Fallback: Direct query
      console.log('[userDataService] get_user_tickets RPC unavailable for count, using direct query');
      const { count, error } = await supabase
        .from('v_joincompetition_active')
        .select('*', { count: 'exact', head: true })
        .or(`wallet_address.ilike.${normalizedWallet},userid.eq.${canonicalId}`);

      if (error) {
        console.error('Error fetching user ticket count:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error in getUserTicketCount:', error);
      return 0;
    }
  },

  // Helper method to get user active tickets count
  async getUserActiveTicketsCount(userId: string): Promise<number> {
    try {
      const canonicalId = toPrizePid(userId);
      const normalizedWallet = this.isWalletAddress(userId) ? userId.toLowerCase() : userId;

      // Try standard RPC first
      const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
        'get_user_tickets', 
        { user_identifier: canonicalId }
      );

      if (!rpcError && rpcData) {
        const typedData = rpcData as any[];
        return typedData.filter((t: any) => t.is_active !== false).length || 0;
      }

      // Fallback: Direct query - uses v_joincompetition_active which only includes active entries
      console.log('[userDataService] get_user_tickets RPC unavailable for active count, using direct query');
      const { count, error } = await supabase
        .from('v_joincompetition_active')
        .select('*', { count: 'exact', head: true })
        .or(`wallet_address.ilike.${normalizedWallet},userid.eq.${canonicalId}`);

      if (error) {
        console.error('Error fetching user active tickets:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error in getUserActiveTicketsCount:', error);
      return 0;
    }
  },

  // Update user profile in the database using RPC function
  // This uses a SECURITY DEFINER function to bypass RLS
  // Fields that can be updated: username, email, telegram_handle, country, telephone_number
  async updateUserProfile(
    userId: string,
    profile: {
      username?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
      country?: string;
      telegram_handle?: string;
      telephone_number?: string;
    }
  ): Promise<boolean> {
    try {
      const canonicalId = toPrizePid(userId);
      console.log('[userDataService] Updating profile for user:', canonicalId, profile);

      // Validate user identifier format
      if (!this.isValidUserIdentifier(userId) && !isPrizePid(userId)) {
        console.error('[userDataService] Invalid user identifier format:', userId);
        return false;
      }

      // Log fields that cannot be saved (legacy fields)
      const unsupportedFields = [];
      if (profile.first_name !== undefined) unsupportedFields.push('first_name');
      if (profile.last_name !== undefined) unsupportedFields.push('last_name');

      if (unsupportedFields.length > 0) {
        console.warn('[userDataService] These legacy fields are not stored in the database and will be ignored:', unsupportedFields);
      }

      // Use RPC function to bypass RLS
      const { data, error } = await (supabase.rpc as any)('update_user_profile_by_identifier', {
        user_identifier: canonicalId,
        new_username: profile.username ?? null,
        new_email: profile.email ?? null,
        new_telegram_handle: profile.telegram_handle ?? null,
        new_country: profile.country ?? null,
        new_telephone_number: profile.telephone_number ?? null,
      });

      if (error) {
        // Provide more detailed error logging
        const errorMessage = error.message || JSON.stringify(error);
        console.error('[userDataService] Profile update failed:', errorMessage);

        // Check for specific error types and provide helpful messages
        if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
          console.error('[userDataService] Database schema mismatch - migration may need to be applied');
        }

        return false;
      }

      // Check the result from the RPC function
      if (data && typeof data === 'object' && 'success' in data) {
        if (data.success) {
          console.log('[userDataService] Profile updated successfully:', data);
          return true;
        } else {
          console.error('[userDataService] Profile update failed:', data.error || 'Unknown error');
          return false;
        }
      }

      // Check for new format: {status: 'ok', canonical_user_id: '...'}
      if (data && typeof data === 'object' && 'status' in data) {
        if (data.status === 'ok' || data.status === 'success') {
          console.log('[userDataService] Profile updated successfully (new format):', data);
          return true;
        } else {
          console.error('[userDataService] Profile update failed (new format):', data);
          return false;
        }
      }

      // If data is null/undefined or doesn't have a success field, the RPC likely failed
      // Don't assume success - log and return false to avoid misleading the user
      if (!data) {
        console.error('[userDataService] Profile update returned no data - RPC may have failed');
        return false;
      }

      // For backwards compatibility: if data is returned but has no success field,
      // check if it looks like a valid response (has rows_affected or similar)
      if (typeof data === 'object' && data !== null && ('rows_affected' in data || 'updated' in data)) {
        const rowsAffected = (data as any).rows_affected ?? (data as any).updated ?? 0;
        if (typeof rowsAffected === 'number' && rowsAffected > 0) {
          console.log('[userDataService] Profile update completed (legacy format):', data);
          return true;
        }
      }

      console.error('[userDataService] Profile update returned unexpected response:', data);
      return false;
    } catch (error) {
      console.error('[userDataService] Error in updateUserProfile:', error);
      return false;
    }
  }
};