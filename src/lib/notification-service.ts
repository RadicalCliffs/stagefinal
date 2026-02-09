import { supabase } from './supabase';
import type { UserNotification } from '../types/notifications';
import { resolveUserIdentity, isWalletAddress, isPrivyDid } from './identity';
import { toPrizePid } from '../utils/userId';

/**
 * Notification Service
 *
 * UPDATED: Now uses Netlify function for write operations to bypass RLS restrictions.
 * Read operations still use direct Supabase queries for performance.
 * Write operations (create, update, delete) use /api/notifications/* endpoints.
 *
 * For wallet-based auth (CDP/Base), notifications are stored with the canonical_users.id
 * as the user_id, or directly with the canonical_user_id if no profile exists.
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
 * Get user profile ID for notifications
 *
 * NOTE: Users MUST go through the sign-up/login flow before connecting a wallet.
 * There are no "wallet-only" users - authentication always comes first, then wallet connection.
 * This function only looks up existing users; it does NOT create new user records.
 */
async function getNotificationUserId(userId: string): Promise<string | null> {
  try {
    // First, try to resolve existing identity
    const identity = await resolveUserIdentity(userId);
    if (identity?.profile?.id) {
      return identity.profile.id;
    }

    // If userId is a wallet address, look up the existing user
    // NOTE: We do NOT create users here - users must register through the auth flow first
    if (isWalletAddress(userId)) {
      const normalizedWallet = userId.toLowerCase();

      // Check if user already exists by wallet address (case-insensitive)
      const existingUserResult = await supabase
        .from('canonical_users')
        .select('id')
        .or(`wallet_address.ilike.${normalizedWallet},base_wallet_address.ilike.${normalizedWallet}`)
        .limit(1) as { data: any; error: any };
      
      const { data: existingUser } = existingUserResult;

      if (existingUser && existingUser.length > 0) {
        return existingUser[0].id;
      }

      // No user found - they need to complete registration first
      console.warn('[NotificationService] No registered user found for wallet:', normalizedWallet);
      console.warn('[NotificationService] Users must complete sign-up/login before connecting a wallet');
    }

    return null;
  } catch (err) {
    console.error('[NotificationService] Error in getNotificationUserId:', err);
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
    try {
      // Use Netlify function to get notifications (handles auth internally)
      const authToken = await getAuthToken();
      if (!authToken) {
        console.warn('[NotificationService] No auth token available');
        return [];
      }

      const response = await fetch('/api/notifications/', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        // Check if response is JSON before trying to parse
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json().catch(() => ({}));
          console.error('[NotificationService] Error fetching notifications:', data.error || response.statusText);
        } else {
          // HTML error page returned (likely 404/500)
          console.error('[NotificationService] Error fetching notifications - HTML error page returned:', response.statusText);
        }
        return [];
      }

      // Verify response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('[NotificationService] Invalid response - expected JSON but got:', contentType);
        return [];
      }

      const result = await response.json();
      return result.notifications || [];
    } catch (err) {
      console.error('[NotificationService] Error fetching notifications:', err);
      return [];
    }
  },

  async getUnreadCount(userId: string): Promise<number> {
    try {
      // Use Netlify function to get unread count (handles auth internally)
      const authToken = await getAuthToken();
      if (!authToken) {
        return 0;
      }

      const response = await fetch('/api/notifications/unread-count', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        return 0;
      }

      // Verify response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('[NotificationService] Invalid unread count response - expected JSON but got:', contentType);
        return 0;
      }

      const result = await response.json();
      return result.count || 0;
    } catch (err) {
      console.error('[NotificationService] Error fetching unread count:', err);
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

    const insertResult = await supabase
      .from('user_notifications')
      .insert(notifications) as { data: any; error: any };
    
    const { error } = insertResult;

    if (error) {
      console.error('Error sending bulk notifications:', error);
    }
  },

  /**
   * Notify user of a successful payment/purchase
   */
  async notifyPayment(userId: string, amount: number, ticketCount: number, competitionTitle?: string): Promise<void> {
    const title = '✅ Payment Successful';
    const message = competitionTitle
      ? `You purchased ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} for "${competitionTitle}" ($${amount.toFixed(2)})`
      : `Your payment of $${amount.toFixed(2)} for ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} was successful`;

    await this.createNotification({
      user_id: userId,
      type: 'payment',
      title,
      message,
      read: false,
    });
  },

  /**
   * Notify user of a successful wallet top-up
   */
  async notifyTopUp(userId: string, amount: number, newBalance?: number): Promise<void> {
    const title = '💰 Top-Up Successful';
    const message = newBalance !== undefined
      ? `$${amount.toFixed(2)} has been added to your wallet. Your new balance is $${newBalance.toFixed(2)}.`
      : `$${amount.toFixed(2)} has been added to your wallet.`;

    await this.createNotification({
      user_id: userId,
      type: 'topup',
      title,
      message,
      read: false,
    });
  },

  /**
   * Notify user of a new competition entry
   */
  async notifyEntry(userId: string, competitionTitle: string, ticketNumbers: number[], competitionId?: string): Promise<void> {
    const ticketCount = ticketNumbers.length;
    const title = '🎟️ Entry Confirmed';
    const message = ticketCount === 1
      ? `Your entry #${ticketNumbers[0]} for "${competitionTitle}" is confirmed. Good luck!`
      : `Your ${ticketCount} entries for "${competitionTitle}" are confirmed (tickets: ${ticketNumbers.slice(0, 5).join(', ')}${ticketNumbers.length > 5 ? '...' : ''}). Good luck!`;

    await this.createNotification({
      user_id: userId,
      type: 'entry',
      title,
      message,
      competition_id: competitionId,
      read: false,
    });
  },

  /**
   * Backfill notifications from user's transaction and entry history
   * This creates notifications for past activity that may not have generated notifications
   */
  async backfillNotificationsFromActivity(userId: string): Promise<{ created: number; errors: number }> {
    let created = 0;
    let errors = 0;

    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        console.warn('[NotificationService] No auth token for backfill');
        return { created: 0, errors: 0 };
      }

      // First, get existing notifications to avoid duplicates
      const existingNotifications = await this.getUserNotifications(userId);
      const existingSet = new Set(
        existingNotifications.map(n => `${n.type}:${n.competition_id || ''}:${n.message?.slice(0, 50) || ''}`)
      );

      // Fetch user transactions using RPC
      const txResult = await supabase.rpc('get_user_transactions', {
        p_user_identifier: toPrizePid(userId),
      }) as { data: any; error: any };
      
      const { data: transactions, error: txError } = txResult;

      if (txError) {
        console.warn('[NotificationService] Could not fetch transactions for backfill:', txError.message);
      } else if (transactions && Array.isArray(transactions)) {
        // Create notifications for successful transactions
        for (const tx of transactions.slice(0, 20)) { // Limit to last 20 transactions
          const amount = Number((tx as any).amount) || 0;
          const ticketCount = Number((tx as any).ticket_count) || 1;
          const txType = (tx as any).type || 'purchase';

          let notifType: 'payment' | 'topup' = 'payment';
          let title = '';
          let message = '';

          if (txType === 'topup' || txType === 'deposit') {
            notifType = 'topup';
            title = '💰 Top-Up Successful';
            message = `$${amount.toFixed(2)} was added to your wallet.`;
          } else {
            notifType = 'payment';
            title = '✅ Payment Successful';
            message = (tx as any).competition_title
              ? `You purchased ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} for "${(tx as any).competition_title}" ($${amount.toFixed(2)})`
              : `Your payment of $${amount.toFixed(2)} for ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} was successful`;
          }

          // Check if similar notification already exists
          const key = `${notifType}:${(tx as any).competition_id || ''}:${message.slice(0, 50)}`;
          if (!existingSet.has(key)) {
            try {
              const response = await fetch('/api/notifications/', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                  type: notifType,
                  title,
                  message,
                  competition_id: (tx as any).competition_id || null,
                  read: true, // Mark backfilled notifications as read
                }),
              });

              if (response.ok) {
                created++;
                existingSet.add(key);
              } else {
                errors++;
              }
            } catch (err) {
              errors++;
            }
          }
        }
      }

      // Fetch user entries using RPC (with fallback for when RPC is not available)
      let entries: any[] = [];
      try {
        const entryRpcResult = await supabase.rpc('get_user_tickets', {
          user_identifier: toPrizePid(userId),
        }) as { data: any; error: any };
        
        const { data: rpcData, error: entryError } = entryRpcResult;

        if (!entryError && rpcData) {
          entries = rpcData;
        } else {
          // RPC not available - skip backfill to avoid complex queries
          // The notification service will create notifications for new entries going forward
          console.warn('[NotificationService] get_user_tickets RPC not available, skipping backfill');
          console.log('[NotificationService] Backfill complete: created 0, errors 0 (RPC not available)');
          return { created: 0, errors: 0 };
        }
      } catch (err) {
        console.warn('[NotificationService] Could not fetch entries for backfill:', err);
        console.log('[NotificationService] Backfill complete: created 0, errors 0');
        return { created: 0, errors: 0 };
      }

      if (entries && Array.isArray(entries)) {
        // Group entries by competition
        const entriesByCompetition = new Map<string, any[]>();
        for (const entry of entries) {
          const compId = entry.competitionid || entry.competition_id || '';
          if (!entriesByCompetition.has(compId)) {
            entriesByCompetition.set(compId, []);
          }
          entriesByCompetition.get(compId)!.push(entry);
        }

        // Create entry notifications (limit to last 10 competitions)
        let compCount = 0;
        for (const [compId, compEntries] of entriesByCompetition) {
          if (compCount >= 10) break;
          compCount++;

          const ticketNumbers = compEntries.flatMap(e => {
            const nums = String(e.ticketnumbers || e.ticket_numbers || '').split(',').map(n => parseInt(n.trim(), 10)).filter(n => Number.isFinite(n));
            return nums;
          }).slice(0, 10);

          if (ticketNumbers.length === 0) continue;

          const competitionTitle = compEntries[0]?.competition_title || compEntries[0]?.title || 'Competition';
          const ticketCount = ticketNumbers.length;

          const title = '🎟️ Entry Confirmed';
          const message = ticketCount === 1
            ? `Your entry #${ticketNumbers[0]} for "${competitionTitle}" is confirmed. Good luck!`
            : `Your ${ticketCount} entries for "${competitionTitle}" are confirmed (tickets: ${ticketNumbers.slice(0, 5).join(', ')}${ticketNumbers.length > 5 ? '...' : ''}). Good luck!`;

          const key = `entry:${compId}:${message.slice(0, 50)}`;
          if (!existingSet.has(key)) {
            try {
              const response = await fetch('/api/notifications/', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                  type: 'entry',
                  title,
                  message,
                  competition_id: compId || null,
                  read: true, // Mark backfilled notifications as read
                }),
              });

              if (response.ok) {
                created++;
                existingSet.add(key);
              } else {
                errors++;
              }
            } catch (err) {
              errors++;
            }
          }
        }
      }

      console.log(`[NotificationService] Backfill complete: created ${created}, errors ${errors}`);
      return { created, errors };
    } catch (err) {
      console.error('[NotificationService] Error in backfillNotificationsFromActivity:', err);
      return { created, errors };
    }
  },
};
