import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  resolveUserIdentity,
  buildIdentityFilter,
  type ResolvedIdentity,
} from '../lib/identity';
import { toPrizePid, userIdsEqual, isWalletAddress } from '../utils/userId';

export interface UserProfile {
  uid: string;
  privy_user_id: string;
  email?: string;
  username?: string;
  wallet_address?: string;
  avatar_url?: string;
  phone?: string;
  created_at: string;
  updated_at?: string;
}

export interface UserWallet {
  usdc_balance: number;
}

export interface UserTicket {
  uid: string;
  competition_id: string;
  competition_title?: string;
  ticket_numbers: number[];
  purchase_date: string;
  status: string;
}

export interface UserOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_status?: string;
  created_at: string;
  competition_id?: string;
  ticket_count?: number;
}

export interface UserProfileData {
  profile: UserProfile | null;
  wallet: UserWallet;
  tickets: UserTicket[];
  orders: UserOrder[];
  ticketsByCompetition: Record<string, UserTicket[]>;
}

interface UseUserProfileResult {
  data: UserProfileData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and manage user profile data from the server.
 * Provides persistent user data including profile, wallet balance, tickets, and orders.
 * 
 * @param privyUserId - The Privy user ID (DID) to fetch profile for
 */
export function useUserProfile(privyUserId: string | null | undefined): UseUserProfileResult {
  const [data, setData] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!privyUserId) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Convert to canonical format for consistent server-side lookup
      const canonicalUserId = toPrizePid(privyUserId);

      // Try to call the server function first
      const { data: serverData, error: serverError } = await supabase.functions.invoke('get-user-profile', {
        body: { privy_user_id: canonicalUserId },
      });

      if (serverError) {
        console.warn('Server function failed, falling back to direct queries:', serverError);
        // Fall back to direct database queries
        await fetchProfileDirect(privyUserId);
        return;
      }

      if (serverData?.ok && serverData?.data) {
        setData({
          profile: serverData.data.profile || null,
          wallet: {
            usdc_balance: serverData.data.wallet?.usdc_balance || 0,
          },
          tickets: serverData.data.tickets || [],
          orders: serverData.data.orders || [],
          ticketsByCompetition: groupTicketsByCompetition(serverData.data.tickets || []),
        });
      } else {
        // Fall back to direct queries if server response is unexpected
        await fetchProfileDirect(privyUserId);
      }
    } catch (err) {
      console.error('Error fetching user profile:', err);
      // Try direct queries as fallback
      try {
        await fetchProfileDirect(privyUserId);
      } catch (fallbackErr) {
        setError(err instanceof Error ? err.message : 'Failed to fetch user profile');
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privyUserId]); // fetchProfileDirect is intentionally excluded - it's a stable function

  const fetchProfileDirect = async (userId: string) => {
    // ISSUE #1 FIX: Use unified identity resolution instead of separate queries
    // This ensures we find the user profile regardless of which identifier type was provided
    const identity = await resolveUserIdentity(userId);

    if (!identity) {
      setData(null);
      return;
    }

    // Use the resolved profile if available
    const profileData = identity.profile;

    // Fetch tickets using unified identity filter
    const ticketFilter = buildIdentityFilter(identity, {
      walletColumn: 'wallet_address',
      privyColumn: 'privy_user_id',
      userIdColumn: 'userid',
    });

    const { data: ticketsData, error: ticketsError } = await supabase
      .from('v_joincompetition_active')
      .select('uid, competitionid, ticketnumbers, purchasedate')
      .or(ticketFilter);

    // Fetch orders/transactions using unified identity filter
    const transactionFilter = buildIdentityFilter(identity, {
      walletColumn: 'wallet_address',
      privyColumn: 'user_id',
      userIdColumn: 'user_id',
    });

    const { data: ordersData, error: ordersError } = await supabase
      .from('user_transactions')
      .select('id, amount, currency, status, payment_status, created_at, competition_id, ticket_count')
      .or(transactionFilter)
      .order('created_at', { ascending: false });

    // Transform tickets data - ensure input is an array
    const ticketsArray = Array.isArray(ticketsData) ? ticketsData : (ticketsData ? [ticketsData] : []);
    const tickets: UserTicket[] = ticketsArray.map((t: any) => ({
      uid: t.uid,
      competition_id: t.competitionid,
      competition_title: t.competition_title,
      ticket_numbers: Array.isArray(t.ticketnumbers)
        ? t.ticketnumbers
        : String(t.ticketnumbers || '').split(',').map((n: string) => parseInt(n.trim(), 10)).filter((n: number) => Number.isFinite(n)),
      purchase_date: t.purchasedate,
      status: t.status || 'active',
    }));

    // Transform orders data - ensure input is an array
    const ordersArray = Array.isArray(ordersData) ? ordersData : (ordersData ? [ordersData] : []);
    const orders: UserOrder[] = ordersArray.map((o: any) => ({
      id: o.id,
      amount: o.amount || 0,
      currency: o.currency || 'USD',
      status: o.status || 'pending',
      payment_status: o.payment_status,
      created_at: o.created_at,
      competition_id: o.competition_id,
      ticket_count: o.ticket_count,
    }));

    setData({
      profile: profileData ? {
        uid: profileData.uid,
        privy_user_id: profileData.privy_user_id,
        email: profileData.email,
        username: profileData.username,
        wallet_address: profileData.wallet_address,
        avatar_url: profileData.avatar_url,
        phone: profileData.phone,
        created_at: profileData.created_at,
        updated_at: profileData.updated_at,
      } : null,
      wallet: {
        usdc_balance: profileData?.usdc_balance || 0,
      },
      tickets,
      orders,
      ticketsByCompetition: groupTicketsByCompetition(tickets),
    });
  };

  // Group tickets by competition for easier display
  const groupTicketsByCompetition = (tickets: UserTicket[]): Record<string, UserTicket[]> => {
    return tickets.reduce((acc, ticket) => {
      const compId = ticket.competition_id;
      if (!acc[compId]) {
        acc[compId] = [];
      }
      acc[compId].push(ticket);
      return acc;
    }, {} as Record<string, UserTicket[]>);
  };

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (!privyUserId) return;

    // Convert to canonical format for consistent matching
    const canonicalUserId = toPrizePid(privyUserId);
    // Determine filter strategy based on identifier type
    const userIsWallet = isWalletAddress(privyUserId);

    // Keep the profile, wallet, tickets, and orders fresh with Supabase realtime
    const channel = supabase
      .channel(`user-profile-${canonicalUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'canonical_users',
          filter: userIsWallet
            ? `wallet_address=eq.${privyUserId.toLowerCase()}`
            : `privy_user_id=eq.${privyUserId}`
        },
        () => fetchProfile()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'v_joincompetition_active',
          filter: userIsWallet
            ? `wallet_address=eq.${privyUserId.toLowerCase()}`
            : `userid=eq.${privyUserId}`
        },
        () => fetchProfile()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_transactions', filter: `user_id=eq.${privyUserId}` },
        () => fetchProfile()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchProfile, privyUserId]);

  return {
    data,
    loading,
    error,
    refresh: fetchProfile,
  };
}
