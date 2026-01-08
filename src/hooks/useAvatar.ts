import { useState, useEffect, useCallback } from 'react';
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
  const [userId, setUserId] = useState<string | null>(null);

  // Get current user ID - supports both Base wallet addresses and legacy Privy DIDs
  // Converts to canonical prize:pid: format for consistent API calls
  const getCurrentUserId = useCallback(() => {
    if (!baseUser?.id) {
      return null;
    }

    // The baseUser.id is the wallet address for Base auth, or DID for legacy Privy
    // Convert to canonical format for consistent API usage
    return toPrizePid(baseUser.id);
  }, [baseUser?.id]);

  // Initialize user ID and avatar URL from profile
  useEffect(() => {
    const currentUserId = getCurrentUserId();
    setUserId(currentUserId);

    // Set avatar URL from profile if available and cache it
    if (profile?.avatar_url) {
      setAvatarUrl(profile.avatar_url);
      userDataService.cacheAvatarUrl(profile.avatar_url);
    }
  }, [getCurrentUserId, profile?.avatar_url]);

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
