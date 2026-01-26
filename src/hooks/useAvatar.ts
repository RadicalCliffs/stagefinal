import { useState, useEffect, useCallback, useMemo } from 'react';
import { userDataService } from '../services/userDataService';
import { useAuthUser } from '../contexts/AuthContext';
import { toPrizePid } from '../utils/userId';

export function useAvatar() {
  const { baseUser, profile, refreshUserData } = useAuthUser();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => {
    // Initialize from cache to prevent flicker on mount
    return userDataService.getCachedAvatarUrl();
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get current user ID - supports both Base wallet addresses and legacy Privy DIDs
  // Converts to canonical prize:pid: format for consistent API calls
  // FORCE ALLOW: Use multiple sources to ensure userId is available
  const userId = useMemo(() => {
    // Priority 1: baseUser.id (wallet address or DID)
    if (baseUser?.id) {
      return toPrizePid(baseUser.id);
    }

    // Priority 2: profile.canonical_user_id (already in canonical format)
    if (profile?.canonical_user_id) {
      return profile.canonical_user_id;
    }

    // Priority 3: profile.wallet_address
    if (profile?.wallet_address) {
      return toPrizePid(profile.wallet_address);
    }

    // Priority 4: profile.id (might be wallet address)
    if (profile?.id && profile.id.startsWith('0x')) {
      return toPrizePid(profile.id);
    }

    return null;
  }, [baseUser?.id, profile?.canonical_user_id, profile?.wallet_address, profile?.id]);

  // Update avatar URL from profile when it changes
  useEffect(() => {
    // Set avatar URL from profile if available and cache it
    if (profile?.avatar_url) {
      setAvatarUrl(profile.avatar_url);
      userDataService.cacheAvatarUrl(profile.avatar_url);
    }
  }, [profile?.avatar_url]);

  // Update avatar function
  const updateAvatar = useCallback(async (newAvatarUrl: string) => {
    if (!userId) {
      const errorMsg = 'No user ID available. Please ensure you are logged in.';
      console.error(errorMsg);
      setError(errorMsg);
      throw new Error(errorMsg);
    }

    setLoading(true);
    setError(null);
    try {
      console.log('Updating avatar for user:', userId, 'with URL:', newAvatarUrl);

      // Use the user ID (wallet address or legacy DID) for the API call
      const success = await userDataService.updateUserAvatar(userId, newAvatarUrl);

      if (!success) {
        throw new Error('Failed to update avatar');
      }

      console.log('Avatar updated successfully');

      // Refresh user data to get the updated profile
      await refreshUserData();

      // Update local state and cache the new avatar URL
      setAvatarUrl(newAvatarUrl);
      userDataService.cacheAvatarUrl(newAvatarUrl);

      return true;
    } catch (err: any) {
      const errorMsg = err?.message || 'Failed to update avatar';
      console.error('Error updating avatar:', err);
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId, refreshUserData]);

  return {
    avatarUrl,
    loading,
    error,
    userId,
    updateAvatar,
    isReady: !!userId, // Indicates whether the hook is ready to perform operations
  };
}
