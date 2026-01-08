import { supabase } from './supabase';
import type { UserNotification } from '../types/notifications';
import { resolveUserIdentity, isWalletAddress, isPrivyDid } from './identity';

/**
 * Notification Service
 *
 * UPDATED: Now uses Netlify function for write operations to bypass RLS restrictions.
 * Read operations still use direct Supabase queries for performance.
 * Write operations (create, update, delete) use /api/notifications/* endpoints.
 */

// Get authentication token for API calls
async function getAuthToken(): Promise<string | null> {
  try {
    // For CDP auth, use the wallet address as the auth identifier
    const walletAddress = localStorage.getItem('cdp:wallet_address') ||
                         localStorage.getItem('base:wallet_address');
    if (walletAddress) {
      return `wallet:${walletAddress}`;
    }

    // Legacy: Try Privy tokens
    const privyToken = localStorage.getItem('privy:token') ||
                       localStorage.getItem('privy:access_token');
    if (privyToken) {
      return privyToken;
    }

    // Fallback to Supabase session token
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return session.access_token;
    }

    return null;
  } catch (err) {
    console.error('Error getting auth token:', err);
    return null;
  }
}

/**
 * Helper function to retry failed Supabase queries with exponential backoff.
 * Handles network errors like ERR_CONNECTION_CLOSED.
 */
async function withRetry<T>(
  operation: () => Promise<{ data: T | null; error: any; count?: number | null }>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<{ data: T | null; error: any; count?: number | null }> {
  let lastError: any = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await operation();

      // If no error, return the result
      if (!result.error) {
        return result;
      }

      // Check if it's a network/connection error worth retrying
      const errorMessage = result.error?.message?.toLowerCase() || '';
      const isNetworkError =
        errorMessage.includes('fetch') ||
        errorMessage.includes('network') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        result.error?.code === 'PGRST301' || // Connection error
        result.error?.code === '57P01'; // Admin shutdown

      if (!isNetworkError) {
        // Non-network error, don't retry
        return result;
      }

      lastError = result.error;

      // Wait before retrying with exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (err) {
      lastError = err;

      // Wait before retrying with exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return { data: null, error: lastError, count: null };
}

/**
 * Builds an OR filter for user_notifications table that handles multiple identifier types.
 * The user_id column in user_notifications may contain:
 * - UUID (legacy format)
 * - Wallet address (Base auth)
 * - Privy DID (legacy Privy auth)
 */
function buildNotificationUserFilter(userId: string, allIdentifiers: string[]): string {
  const filters: string[] = [];
  const seen = new Set<string>();

  // Add the primary userId
  if (userId && !seen.has(userId.toLowerCase())) {
    filters.push(`user_id.eq.${userId}`);
    seen.add(userId.toLowerCase());
  }

  // Add all known identifiers
  for (const id of allIdentifiers) {
    const normalized = id.toLowerCase();
    if (!seen.has(normalized)) {
      filters.push(`user_id.eq.${id}`);
      seen.add(normalized);
    }
  }

  return filters.join(',');
}

export const notificationService = {
  async getUserNotifications(userId: string): Promise<UserNotification[]> {
    // Resolve user identity to get all possible identifiers
    const identity = await resolveUserIdentity(userId);

    // The user_notifications table stores user_id as UUID, so we need the profile.id
    const profileId = identity?.profile?.id;

    // If no profile ID is found, we can't query the notifications table
    // because wallet addresses won't match UUID user_id columns
    if (!profileId) {
      // Return empty array silently - no profile means no notifications
      return [];
    }

    // Query using only the UUID profile ID since the table uses UUID type
    const { data, error } = await withRetry(() =>
      supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', profileId)
        .order('created_at', { ascending: false })
    );

    if (error) {
      console.error('Error fetching notifications:', error);
      return [];
    }

    return data || [];
  },

  async getUnreadCount(userId: string): Promise<number> {
    try {
      // Resolve user identity to get all possible identifiers
      const identity = await resolveUserIdentity(userId);

      // If we have a resolved identity with a UUID profile, use that
      // The user_notifications table stores user_id as UUID, so we need the profile.id
      const profileId = identity?.profile?.id;

      // If no profile ID is found, we can't query the notifications table
      // because wallet addresses won't match UUID user_id columns
      if (!profileId) {
        // Return 0 silently - no profile means no notifications
        return 0;
      }

      // Query using only the UUID profile ID since the table uses UUID type
      const { count, error } = await withRetry(() =>
        supabase
          .from('user_notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', profileId)
          .eq('read', false)
      );

      if (error) {
        console.error('Error fetching unread count:', error);
        return 0;
      }

      return count || 0;
    } catch (err) {
      // Gracefully handle errors - don't break the UI for notification counts
      console.error('Error fetching unread count:', err);
      return 0;
    }
  },

  async markAsRead(notificationId: string): Promise<boolean> {
    try {
      // Use Netlify function for write operations to bypass RLS
      const authToken = await getAuthToken();
      if (!authToken) {
        console.error('No auth token available for marking notification as read');
        return false;
      }

      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error('Error marking notification as read:', data.error || response.statusText);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error marking notification as read:', err);
      return false;
    }
  },

  async markAllAsRead(_userId: string): Promise<boolean> {
    try {
      // Use Netlify function for write operations to bypass RLS
      const authToken = await getAuthToken();
      if (!authToken) {
        console.error('No auth token available for marking all notifications as read');
        return false;
      }

      const response = await fetch('/api/notifications/read-all', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error('Error marking all notifications as read:', data.error || response.statusText);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
      return false;
    }
  },

  async createNotification(notification: Omit<UserNotification, 'id' | 'created_at'>): Promise<UserNotification | null> {
    try {
      // Use Netlify function for write operations to bypass RLS
      const authToken = await getAuthToken();
      if (!authToken) {
        console.error('No auth token available for creating notification');
        return null;
      }

      const response = await fetch('/api/notifications/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(notification),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error('Error creating notification:', data.error || response.statusText);
        return null;
      }

      const result = await response.json();
      return result.notification || null;
    } catch (err) {
      console.error('Error creating notification:', err);
      return null;
    }
  },

  async deleteNotification(notificationId: string): Promise<boolean> {
    try {
      // Use Netlify function for write operations to bypass RLS
      const authToken = await getAuthToken();
      if (!authToken) {
        console.error('No auth token available for deleting notification');
        return false;
      }

      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error('Error deleting notification:', data.error || response.statusText);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error deleting notification:', err);
      return false;
    }
  },

  async notifyWinner(userId: string, competitionId: string, prize: string): Promise<void> {
    await this.createNotification({
      user_id: userId,
      type: 'win',
      title: '🎉 Congratulations! You Won!',
      message: `You have won ${prize}! Check your entries for more details.`,
      competition_id: competitionId,
      prize_info: prize,
      read: false,
    });
  },

  async notifyCompetitionEnded(userId: string, competitionId: string, competitionTitle: string): Promise<void> {
    await this.createNotification({
      user_id: userId,
      type: 'competition_ended',
      title: 'Competition Ended',
      message: `The competition "${competitionTitle}" has ended. Check the winners page to see the results.`,
      competition_id: competitionId,
      read: false,
    });
  },

  async notifySpecialOffer(userId: string, title: string, message: string, expiresAt?: string): Promise<void> {
    await this.createNotification({
      user_id: userId,
      type: 'special_offer',
      title,
      message,
      read: false,
      expires_at: expiresAt,
    });
  },

  async sendBulkNotification(userIds: string[], title: string, message: string, type: UserNotification['type'] = 'announcement'): Promise<void> {
    const notifications = userIds.map(userId => ({
      user_id: userId,
      type,
      title,
      message,
      read: false,
      created_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('user_notifications')
      .insert(notifications);

    if (error) {
      console.error('Error sending bulk notifications:', error);
    }
  },
};
