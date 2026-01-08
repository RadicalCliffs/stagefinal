import { supabase } from '../lib/supabase';
import { toPrizePid, isPrizePid } from '../utils/userId';

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

// Avatar URLs from Supabase public storage bucket "Avatars"
// These are the official 777btc avatars that are publicly accessible
const SUPABASE_AVATAR_BASE_URL = 'https://cyxjzycxnfqctxocolwr.supabase.co/storage/v1/object/public/Avatars';

// Cache key for persisting avatar URL across page navigations
const AVATAR_CACHE_KEY = 'user_avatar_cache';

// All available avatars - using the correct 777btc naming convention
const allAvatarFilenames = [
  '777btc_Avatars_EH-01.png',
  '777btc_Avatars_EH-02.png',
  '777btc_Avatars_EH-03.png',
  '777btc_Avatars_EH-04.png',
  '777btc_Avatars_EH-05.png',
  '777btc_Avatars_EH-06.png',
  '777btc_Avatars_EH-07.png',
  '777btc_Avatars_EH-08.png',
  '777btc_Avatars_EH-09.png',
  '777btc_Avatars_EH-10.png',
  '777btc_Avatars_EH-11.png',
  '777btc_Avatars_EH-12.png',
  '777btc_Avatars_EH-13.png',
  '777btc_Avatars_EH-14.png',
  '777btc_Avatars_EH-15.png',
  '777btc_Avatars_EH-16.png',
  '777btc_Avatars_EH-17.png',
  '777btc_Avatars_EH-18.png',
  '777btc_Avatars_EH-19.png',
  '777btc_Avatars_EH-20.png',
  '777btc_Avatars_EH-21.png',
  '777btc_Avatars_EH-22.png',
  '777btc_Avatars_EH-23.png',
  '777btc_Avatars_EH-24.png',
  '777btc_Avatars_EH-25.png',
  '777btc_Avatars_EH-26.png',
  '777btc_Avatars_EH-27.png',
  '777btc_Avatars_EH-28.png',
  '777btc_Avatars_EH-29.png',
  '777btc_Avatars_EH-30.png',
];

export const userDataService = {
  // Get avatar URL from Supabase storage - using hardcoded base URL for reliability
  getAvatarUrl(avatarFileName: string): string {
    return `${SUPABASE_AVATAR_BASE_URL}/${avatarFileName}`;
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
    return this.getAvatarUrl(allAvatarFilenames[0]);
  },

  // Get a random avatar - should only be called ONCE during account creation
  // Do NOT use this for getting current avatar display
  getRandomAvatar(): string {
    const randomIndex = Math.floor(Math.random() * allAvatarFilenames.length);
    return this.getAvatarUrl(allAvatarFilenames[randomIndex]);
  },

  // Get all available avatars for selection - using the 777btc avatars
  getAllAvatars(): AvatarOption[] {
    return allAvatarFilenames.map((filename, index) => ({
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
      const { data, error } = await supabase.rpc('update_user_avatar', {
        user_identifier: canonicalUserId,
        new_avatar_url: avatarUrl
      });

      if (error) {
        console.error('[userDataService] Error updating user avatar:', error);
        return false;
      }

      // Check the result from the RPC function
      if (data && typeof data === 'object' && 'success' in data) {
        if (data.success) {
          console.log('[userDataService] Avatar updated successfully:', data);
          return true;
        } else {
          console.error('[userDataService] Avatar update failed:', data.error);
          return false;
        }
      }

      console.log('[userDataService] Avatar update completed:', data);
      return true;
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

    try {
      // Get user tickets using RPC to bypass RLS
      const { data: tickets, error: ticketsError } = await supabase
        .rpc('get_user_tickets_bypass_rls', { user_identifier: canonicalId });

      if (ticketsError) {
        console.error('Error fetching user tickets:', ticketsError);
      }

      // Get user balance using get_user_balance RPC for consistent lookups
      const { data: rpcBalance, error: rpcError } = await supabase.rpc('get_user_balance', {
        p_canonical_user_id: canonicalId
      });

      let walletBalance = 0;
      if (!rpcError && rpcBalance !== null) {
        walletBalance = Number(rpcBalance) || 0;
      } else {
        // Fallback: Direct query to wallet_balances view
        const { data: userBalance, error: balanceError } = await supabase
          .from('wallet_balances')
          .select('balance')
          .eq('canonical_user_id', canonicalId)
          .single();

        if (balanceError) {
          console.error('Error fetching user balance:', balanceError);
        }
        walletBalance = Number(userBalance?.balance || 0);
      }

      // Get recent entries count using RPC to bypass RLS
      const { data: recentCountData } = await supabase
        .rpc('get_recent_entries_count_bypass_rls', {
          user_identifier: canonicalId
        });

      // Calculate aggregation
      const ticketsData = tickets || [];
      const totalTickets = ticketsData.length;
      const activeTickets = ticketsData.filter((t: any) => t.is_active !== false).length;
      const recentEntries = Number(recentCountData || 0);

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
      const { data: tickets, error } = await supabase
        .rpc('get_user_tickets_bypass_rls', { user_identifier: canonicalId });

      if (error) {
        console.error('Error fetching user ticket count:', error);
        return 0;
      }

      return tickets?.length || 0;
    } catch (error) {
      console.error('Error in getUserTicketCount:', error);
      return 0;
    }
  },

  // Helper method to get user active tickets count
  async getUserActiveTicketsCount(userId: string): Promise<number> {
    try {
      const canonicalId = toPrizePid(userId);
      const { data: tickets, error } = await supabase
        .rpc('get_user_tickets_bypass_rls', { user_identifier: canonicalId });

      if (error) {
        console.error('Error fetching user active tickets:', error);
        return 0;
      }

      return tickets?.filter((t: any) => t.is_active !== false).length || 0;
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
      const { data, error } = await supabase.rpc('update_user_profile_by_identifier', {
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

      // If data is null/undefined or doesn't have a success field, the RPC likely failed
      // Don't assume success - log and return false to avoid misleading the user
      if (!data) {
        console.error('[userDataService] Profile update returned no data - RPC may have failed');
        return false;
      }

      // For backwards compatibility: if data is returned but has no success field,
      // check if it looks like a valid response (has rows_affected or similar)
      if (typeof data === 'object' && ('rows_affected' in data || 'updated' in data)) {
        const rowsAffected = data.rows_affected ?? data.updated ?? 0;
        if (rowsAffected > 0) {
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