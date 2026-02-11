import { Link, useOutletContext, useSearchParams } from "react-router";
import EntriesCard from "./EntriesCard";
import type { Options } from "../../../models/models";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { database } from "../../../lib/database";
import { supabase } from "../../../lib/supabase";
import Loader from "../../Loader";
import { useAuthUser } from '../../../contexts/AuthContext';
import { useToast } from '../../Toast';
import { Ticket, Trophy, AlertCircle, Clock, Zap, RefreshCw } from 'lucide-react';
import { FINISHED_COMPETITION_STATUSES } from '../../../constants/competition-status';

const ITEMS_PER_PAGE = 20;

/**
 * Normalizes a wallet address to lowercase for consistent comparison.
 * Ethereum addresses are case-insensitive, so we always compare in lowercase.
 */
function normalizeAddress(address: string | undefined | null): string {
  if (!address) return '';
  return address.toLowerCase();
}

/**
 * Checks if a record matches the current user using case-insensitive wallet comparison.
 * This handles the case where database stores mixed-case addresses.
 * UPDATED: Now checks canonical_user_id as the primary identifier
 */
function recordMatchesUser(
  record: { canonical_user_id?: string; walletaddress?: string; privy_user_id?: string; userid?: string; user_id?: string; wallet_address?: string },
  normalizedUserId: string,
  originalUserId: string
): boolean {
  // Check canonical_user_id FIRST (highest priority)
  const matchesCanonical = record.canonical_user_id === originalUserId ||
                          normalizeAddress(record.canonical_user_id) === normalizedUserId;
  // Case-insensitive wallet address comparison
  const matchesWallet = normalizeAddress(record.wallet_address) === normalizedUserId;
  const matchesWallet2 = normalizeAddress(record.wallet_address) === normalizedUserId;
  // Check privy_user_id - could be a Privy DID or a wallet address stored in this column
  const matchesPrivyId = record.privy_user_id === originalUserId ||
                         normalizeAddress(record.privy_user_id) === normalizedUserId;
  // Check user_id column (used in pending_tickets table)
  const matchesUserId = record.user_id === originalUserId ||
                        normalizeAddress(record.user_id) === normalizedUserId;
  // Check legacy userid column
  const matchesLegacyUserId = record.userid === originalUserId ||
                              normalizeAddress(record.userid) === normalizedUserId;

  return matchesCanonical || matchesWallet || matchesWallet2 || matchesPrivyId || matchesUserId || matchesLegacyUserId;
}

// Interface for grouped competition entries
interface GroupedCompetitionEntry {
  competition_id: string;
  title: string;
  description: string;
  image: string;
  status: 'live' | 'completed' | 'drawn' | 'pending';
  entry_type: string;
  is_winner: boolean;
  total_tickets: number;
  all_ticket_numbers: string;
  total_amount_spent: number;
  first_purchase_date: string;
  last_purchase_date: string;
  transaction_hashes: string[];
  prize_value: string;
  competition_status: string;
  end_date: string;
  entry_ids: string[];
  // For pending entries
  is_pending: boolean;
  expires_at?: string;
  // For instant win entries
  is_instant_win: boolean;
}

export default function EntriesList() {
  const { activeTab } = useOutletContext<{ activeTab: Options }>();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const { baseUser, canonicalUserId, authenticated } = useAuthUser();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ISSUE 9A FIX: Track background refresh state separately from initial loading
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Debounce timer ref to prevent excessive refreshes from rapid real-time updates
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if we've loaded entries at least once to avoid showing loader during background refreshes
  const initialLoadDoneRef = useRef(false);
  // Track consecutive errors for toast notification throttling
  const consecutiveErrorsRef = useRef(0);

  // Function to fetch dashboard entries
  const fetchEntries = useCallback(async (isBackgroundRefresh = false) => {
    if (!canonicalUserId) {
      console.warn('[EntriesList] No canonical user ID available, skipping fetch');
      setLoading(false);
      return;
    }

    // Only show loading state on initial load, not on background refreshes
    if (!initialLoadDoneRef.current) {
      setLoading(true);
    }

    // ISSUE 9A FIX: Show refreshing indicator during background updates
    if (isBackgroundRefresh && initialLoadDoneRef.current) {
      setIsRefreshing(true);
    }

    setError(null);

    try {
      console.log('[Dashboard.Entries] Fetching entries:', {
        canonicalUserId,
        isBackgroundRefresh,
        timestamp: new Date().toISOString()
      });

      // Try fetching from competition_entries table first (new unified source)
      // Falls back to legacy getUserEntries if the new RPC is not available
      // Use canonicalUserId (prize:pid:<wallet>) to match database records
      const data = await database.getUserEntriesFromCompetitionEntries(canonicalUserId);
      
      console.log('[Dashboard.Entries] Fetched entries:', {
        count: data?.length || 0,
        sampleEntry: data?.[0] ? {
          id: data[0].id,
          competition_id: data[0].competition_id,
          title: data[0].title,
          status: data[0].status,
          ticket_numbers: data[0].ticket_numbers,
          amount_spent: data[0].amount_spent,
          image: data[0].image?.substring(0, 50) + '...'
        } : null,
        allTitles: data?.map((e: any) => e.title).filter(Boolean)
      });

      setEntries(data || []);
      initialLoadDoneRef.current = true;
      // Reset consecutive error counter on success
      consecutiveErrorsRef.current = 0;

      // ISSUE 4C FIX: After initial load, try to sync stale competition statuses
      // This runs in the background and doesn't block the UI
      if (data && data.length > 0 && !isBackgroundRefresh) {
        // Filter out synthetic IDs (legacy-* or entry-*) that aren't real UUIDs
        const competitionIds = [...new Set(
          data
            .map((e: any) => e.competition_id)
            .filter(id => id && !id.startsWith('legacy-') && !id.startsWith('entry-'))
        )];
        if (competitionIds.length > 0) {
          console.log('[Dashboard.Entries] Syncing competition statuses:', { count: competitionIds.length });
          // Run sync in background - don't await to avoid blocking UI
          database.syncStaleCompetitionStatuses(competitionIds).then(result => {
            if (result.updated.length > 0) {
              // If any competitions were updated, refresh entries to get updated status
              console.log('[Dashboard.Entries] Synced stale competitions, refreshing...', { updated: result.updated.length });
              debouncedFetchEntries();
            }
          }).catch((syncErr) => {
            // Ignore errors - stale status sync is a nice-to-have
            console.warn('[Dashboard.Entries] Sync failed (non-critical):', syncErr);
          });
        }
      }
    } catch (err) {
      console.error('[Dashboard.Entries] Error fetching entries:', err);

      // ISSUE 8A FIX: Show toast notification for errors instead of silently failing
      // Only show toast on first error or after 3 consecutive errors to avoid spam
      consecutiveErrorsRef.current++;
      if (consecutiveErrorsRef.current === 1 || consecutiveErrorsRef.current % 3 === 0) {
        showToast(
          initialLoadDoneRef.current
            ? "Unable to refresh entries. Your data may be outdated."
            : "Failed to load your entries. Please try again.",
          'error',
          5000
        );
      }

      // Only show error state on initial load failures
      if (!initialLoadDoneRef.current) {
        setError("Failed to load your entries. Please try again.");
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalUserId, showToast]); // debouncedFetchEntries excluded to avoid circular dependency

  // Debounced refresh function to prevent excessive API calls from rapid real-time updates
  // ISSUE 9A FIX: Pass isBackgroundRefresh=true to show refresh indicator
  const debouncedFetchEntries = useCallback(() => {
    if (refreshDebounceRef.current) {
      clearTimeout(refreshDebounceRef.current);
    }
    refreshDebounceRef.current = setTimeout(() => {
      fetchEntries(true); // Mark as background refresh
    }, 500); // 500ms debounce
  }, [fetchEntries]);

  // Check for payment success/cancelled parameters in URL and show appropriate message
  useEffect(() => {
    const paymentStatus = searchParams.get('payment');
    const status = searchParams.get('status');
    
    // Helper function to clean up URL parameters
    const cleanupUrlParams = (...paramsToRemove: string[]) => {
      const newParams = new URLSearchParams(searchParams);
      paramsToRemove.forEach(param => newParams.delete(param));
      setSearchParams(newParams, { replace: true });
    };
    
    if (paymentStatus === 'success') {
      showToast('Payment successful! Your entries will appear below.', 'success');
      cleanupUrlParams('payment', 'txId', 'status');
      // Refresh entries to show the new purchase
      debouncedFetchEntries();
    } else if (paymentStatus === 'cancelled') {
      showToast('Payment was cancelled. You can try again anytime.', 'info');
      cleanupUrlParams('payment', 'txId', 'status');
    } else if (status === 'complete') {
      // Handle legacy status parameter from onramp/offramp redirects
      showToast('Transaction completed successfully!', 'success');
      cleanupUrlParams('status');
      debouncedFetchEntries();
    }
  }, [searchParams, showToast, setSearchParams, debouncedFetchEntries]);

  useEffect(() => {
    fetchEntries(false); // Initial load, not background refresh

    // Set up real-time subscriptions for dashboard updates
    // Use canonicalUserId for channel names to match database records
    if (canonicalUserId) {
      // For matching records, use both canonical and normalized wallet
      const normalizedWallet = baseUser?.id ? baseUser.id.toLowerCase() : '';

      // Channel for user's competition entries from the new competition_entries table (PRIMARY)
      // This is the new unified source for all competition entries
      const competitionEntriesChannel = supabase
        .channel(`competition-entries-${canonicalUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'competition_entries',
          },
          (payload) => {
            // Use the helper function for robust case-insensitive matching
            const record = payload.new as {
              canonical_user_id?: string;
              wallet_address?: string;
              user_id?: string;
            };

            if (recordMatchesUser(record, normalizedWallet, canonicalUserId)) {
              console.log('[EntriesList] Competition entry change detected:', payload.eventType);
              // Use debounced refresh to prevent rapid consecutive API calls
              debouncedFetchEntries();
            }
          }
        )
        .subscribe();

      // Channel for user's competition entries (LEGACY - v_joincompetition_active)
      // Kept for backwards compatibility during migration
      const entriesChannel = supabase
        .channel(`user-entries-${canonicalUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'v_joincompetition_active',
          },
          (payload) => {
            // Use the helper function for robust case-insensitive matching
            const record = payload.new as {
              wallet_address?: string;
              userid?: string;
            };

            if (recordMatchesUser(record, normalizedWallet, canonicalUserId)) {
              console.log('Entry change detected:', payload.eventType, 'for user');
              // Use debounced refresh to prevent rapid consecutive API calls
              debouncedFetchEntries();
            }
          }
        )
        .subscribe();

      // Channel for pending ticket reservations (INSERT/UPDATE/DELETE)
      // Subscribe without filter and apply case-insensitive matching in callback
      const pendingTicketsChannel = supabase
        .channel(`user-pending-${canonicalUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'pending_tickets',
          },
          (payload) => {
            // Use the helper function for robust case-insensitive matching
            const record = payload.new as {
              user_id?: string;
              wallet_address?: string;
            };

            if (recordMatchesUser(record, normalizedWallet, canonicalUserId)) {
              console.log('Pending ticket change detected:', payload.eventType);
              // Use debounced refresh
              debouncedFetchEntries();
            }
          }
        )
        .subscribe();

      // Channel for competition status updates (when competitions are drawn)
      const competitionStatusChannel = supabase
        .channel('competition-status-updates')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'competitions'
          },
          (payload) => {
            // Refresh entries when any competition status changes (e.g., becomes 'drawn' or 'completed')
            const newStatus = (payload.new as any)?.status;
            if (newStatus === 'completed' || newStatus === 'drawing' || newStatus === 'drawn') {
              console.log('Competition status changed to:', newStatus);
              debouncedFetchEntries();
            }
          }
        )
        .subscribe();

      // Channel for user_transactions updates (for balance and crypto payments)
      const userTransactionsChannel = supabase
        .channel(`user-transactions-${canonicalUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_transactions',
          },
          (payload) => {
            // Check if this transaction belongs to the current user
            const record = payload.new as {
              canonical_user_id?: string;
              wallet_address?: string;
              user_id?: string;
              status?: string;
              payment_status?: string;
            };

            if (recordMatchesUser(record, normalizedWallet, canonicalUserId)) {
              // Refresh on completed/confirmed transactions
              const status = (record.status || record.payment_status || '').toLowerCase();
              if (status === 'completed' || status === 'complete' || status === 'confirmed' || status === 'finished' || status === 'success' || status === 'paid') {
                console.log('[EntriesList] User transaction completed:', payload.eventType, status);
                debouncedFetchEntries();
              }
            }
          }
        )
        .subscribe();

      // Channel for balance_ledger changes (for balance-based purchases)
      const balanceLedgerChannel = supabase
        .channel(`balance-ledger-${canonicalUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'balance_ledger',
          },
          (payload) => {
            // Check if this is a purchase entry (source = 'purchase')
            const record = payload.new as {
              user_id?: string;
              source?: string;
              metadata?: any;
            };

            // balance_ledger entries are matched by user_id (UUID from canonical_users)
            // The source should be 'purchase' for competition entries
            if (record.source === 'purchase' && record.metadata?.competition_id) {
              console.log('[EntriesList] Balance ledger purchase detected:', payload.eventType);
              debouncedFetchEntries();
            }
          }
        )
        .subscribe();

      // Channel for winners table (to detect when user wins)
      const winnersChannel = supabase
        .channel(`winners-${canonicalUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'winners',
          },
          (payload) => {
            // Check if this winner record belongs to the current user
            const record = payload.new as {
              canonical_user_id?: string;
              wallet_address?: string;
              user_id?: string;
            };

            if (recordMatchesUser(record, normalizedWallet, canonicalUserId)) {
              console.log('[EntriesList] Winner update detected:', payload.eventType);
              debouncedFetchEntries();
            }
          }
        )
        .subscribe();

      // Listen for balance-updated events (dispatched after successful payments/top-ups)
      // This ensures entries refresh immediately after wallet balance changes
      const handleBalanceUpdated = () => {
        console.log('[EntriesList] Balance updated event detected, refreshing entries');
        debouncedFetchEntries();
      };

      window.addEventListener('balance-updated', handleBalanceUpdated);

      // Cleanup subscriptions and debounce timer on unmount
      return () => {
        if (refreshDebounceRef.current) {
          clearTimeout(refreshDebounceRef.current);
        }
        window.removeEventListener('balance-updated', handleBalanceUpdated);
        supabase.removeChannel(competitionEntriesChannel);
        supabase.removeChannel(entriesChannel);
        supabase.removeChannel(pendingTicketsChannel);
        supabase.removeChannel(competitionStatusChannel);
        supabase.removeChannel(userTransactionsChannel);
        supabase.removeChannel(balanceLedgerChannel);
        supabase.removeChannel(winnersChannel);
      };
    }
  }, [canonicalUserId, fetchEntries, debouncedFetchEntries, baseUser?.id]);

  // Reset to first page when tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab.key]);

  // ISSUE 4B FIX: Simplified status filtering logic with clearer status normalization
  // The goal is to categorize entries into Live, Pending, Instant, or Finished tabs
  const filteredEntries = entries.filter((entry) => {
    // ISSUE 4B FIX: Clearer status determination logic
    // Step 1: Check if the competition has actually ended based on end_date
    // This is the most reliable indicator since scheduled jobs may lag
    const now = new Date();
    const endDate = entry.end_date ? new Date(entry.end_date) : null;
    const isCompetitionEnded = endDate !== null && endDate < now;

    // Step 2: Normalize the status from database
    // Map all finished statuses to 'completed' for consistent filtering
    const rawStatus = (entry.status || '').toLowerCase().trim();
    const normalizedStatus = rawStatus === 'active' ? 'live'
      : rawStatus === 'drawing' ? 'drawn'
      : FINISHED_COMPETITION_STATUSES.includes(rawStatus as any) ? 'completed'
      : rawStatus || 'live';

    // Step 3: Determine effective status
    // ISSUE 4C FIX: Use end_date as source of truth for "ended" status
    // If end_date has passed but status is still 'live', treat as 'completed'
    // Also treat 'sold_out' competitions as 'completed' (they're finished)
    const effectiveStatus = isCompetitionEnded && normalizedStatus === 'live' ? 'completed' : normalizedStatus;

    // Step 4: Determine entry type (completed vs pending)
    // FIX: Include balance_purchase and transaction entry types from RPC
    const entryType = (entry.entry_type || '').toLowerCase().trim();
    const isCompletedEntry = !entryType ||
      entryType === 'completed' ||
      entryType === 'completed_transaction' ||
      entryType === 'completed_from_tickets' ||
      entryType === 'confirmed' ||
      entryType === 'finished' ||
      entryType === 'balance_purchase' ||
      entryType === 'transaction' ||
      entryType === 'competition_entry' ||
      entryType === 'ticket';

    const isPendingEntry = entryType === 'pending' || entryType === 'pending_ticket' || normalizedStatus === 'pending';
    const isInstantWin = entry.is_instant_win === true;

    // Step 5: Route to appropriate tab
    let willShow = false;

    switch (activeTab.key) {
      case 'live':
        // Live tab: Completed entries for competitions that are truly live
        // effectiveStatus handles both time-based expiration and sold-out status
        willShow = (effectiveStatus === 'live') && isCompletedEntry && !isInstantWin && !isPendingEntry;
        break;

      case 'pending':
        // Pending tab: Entries awaiting payment confirmation
        willShow = isPendingEntry;
        break;

      case 'instant':
        // Instant tab: All instant win entries (completed purchases only)
        willShow = isInstantWin && isCompletedEntry && !isPendingEntry;
        break;

      case 'finished':
      default:
        // Finished tab: Completed/drawn competitions (confirmed entries only), excluding instant wins
        willShow = (effectiveStatus === 'completed' || effectiveStatus === 'drawn') &&
                   isCompletedEntry && !isInstantWin && !isPendingEntry;
        break;
    }

    // Debug logging (can be disabled in production)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[EntriesList] Entry filter:', {
        id: entry.id?.substring?.(0, 8) || entry.id,
        title: entry.title?.substring?.(0, 20) || 'unknown',
        rawStatus,
        effectiveStatus,
        entryType,
        isCompetitionEnded,
        isInstantWin,
        tab: activeTab.key,
        willShow
      });
    }

    return willShow;
  });

  // Group entries by competition_id - amalgamate all entries for the same competition
  // ISSUE 4A FIX: Improved deduplication to handle multiple data sources more robustly
  const groupedEntries = useMemo(() => {
    // ISSUE 4A FIX: Enhanced deduplication using multiple criteria to catch duplicates
    // across different tables (joincompetition, tickets, user_transactions, pending_tickets)
    const deduplicatedEntries = filteredEntries.reduce((acc: any[], entry) => {
      // Normalize ticket numbers for comparison
      const sortedTickets = entry.ticket_numbers
        ? entry.ticket_numbers.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '').sort((a: string, b: string) => parseInt(a) - parseInt(b)).join(',')
        : '';

      // Round purchase date to minute for comparison (handles slight timestamp variations)
      const roundedDate = entry.purchase_date
        ? Math.floor(new Date(entry.purchase_date).getTime() / 60000) // Round to minute
        : 0;

      // ISSUE 4A FIX: Create multiple dedupe keys to catch different duplicate patterns
      // Pattern 1: Same competition + same tickets (exact duplicate)
      const exactDupeKey = `${entry.competition_id}|${sortedTickets}`;

      // Pattern 2: Same competition + same amount + same time window (likely same purchase)
      const amountTimeDupeKey = `${entry.competition_id}|${entry.amount_spent}|${roundedDate}`;

      // Pattern 3: Same transaction hash (idempotency)
      const txHashDupeKey = entry.transaction_hash && entry.transaction_hash !== 'no-hash'
        ? `tx:${entry.transaction_hash}`
        : null;

      // Check if we already have an entry matching any of these patterns
      const existingIndex = acc.findIndex((e: any) => {
        // Exact ticket match
        const existingSortedTickets = e.ticket_numbers
          ? e.ticket_numbers.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '').sort((a: string, b: string) => parseInt(a) - parseInt(b)).join(',')
          : '';
        const existingExactKey = `${e.competition_id}|${existingSortedTickets}`;

        if (exactDupeKey === existingExactKey && sortedTickets !== '') {
          return true;
        }

        // Amount + time window match (within same minute)
        const existingRoundedDate = e.purchase_date
          ? Math.floor(new Date(e.purchase_date).getTime() / 60000)
          : 0;
        const existingAmountTimeKey = `${e.competition_id}|${e.amount_spent}|${existingRoundedDate}`;

        if (amountTimeDupeKey === existingAmountTimeKey && entry.amount_spent > 0) {
          return true;
        }

        // Transaction hash match
        if (txHashDupeKey && e.transaction_hash && e.transaction_hash !== 'no-hash') {
          if (`tx:${e.transaction_hash}` === txHashDupeKey) {
            return true;
          }
        }

        return false;
      });

      if (existingIndex === -1) {
        acc.push(entry);
      } else {
        // ISSUE 4A FIX: When merging duplicates, prefer the entry with more complete data
        const existing = acc[existingIndex];
        const existingDataScore = (existing.ticket_numbers ? 1 : 0) + (existing.amount_spent > 0 ? 1 : 0) + (existing.transaction_hash ? 1 : 0);
        const newDataScore = (entry.ticket_numbers ? 1 : 0) + (entry.amount_spent > 0 ? 1 : 0) + (entry.transaction_hash ? 1 : 0);

        if (newDataScore > existingDataScore) {
          // Replace with more complete entry
          acc[existingIndex] = entry;
        }
      }
      return acc;
    }, []);

    const groupMap = new Map<string, GroupedCompetitionEntry>();

    deduplicatedEntries.forEach((entry) => {
      const key = entry.competition_id;

      // Calculate effective status based on end_date (for proper display)
      // Use 'completed' for competitions that have ended but haven't been drawn yet
      const isCompetitionEnded = entry.end_date && new Date(entry.end_date) < new Date();
      const effectiveStatus = isCompetitionEnded && entry.status === 'live' ? 'completed' : entry.status;

      if (!groupMap.has(key)) {
        // Initialize new group for this competition
        groupMap.set(key, {
          competition_id: entry.competition_id,
          title: entry.title,
          description: entry.description,
          image: entry.image,
          status: effectiveStatus as 'live' | 'completed' | 'drawn' | 'pending',
          entry_type: entry.entry_type,
          is_winner: entry.is_winner || false,
          total_tickets: entry.number_of_tickets || 0,
          all_ticket_numbers: entry.ticket_numbers || '',
          total_amount_spent: parseFloat(entry.amount_spent) || 0,
          first_purchase_date: entry.purchase_date,
          last_purchase_date: entry.purchase_date,
          transaction_hashes: entry.transaction_hash && entry.transaction_hash !== 'no-hash'
            ? [entry.transaction_hash]
            : [],
          prize_value: entry.prize_value,
          competition_status: entry.competition_status,
          end_date: entry.end_date,
          entry_ids: [entry.id],
          is_pending: entry.entry_type === 'pending' || entry.status === 'pending',
          expires_at: entry.expires_at,
          is_instant_win: entry.is_instant_win || false
        });
      } else {
        // Aggregate with existing group
        const existing = groupMap.get(key)!;

        // Aggregate ticket numbers (combine and dedupe)
        const existingTickets = existing.all_ticket_numbers ? existing.all_ticket_numbers.split(',').map(t => t.trim()) : [];
        const newTickets = entry.ticket_numbers ? entry.ticket_numbers.split(',').map((t: string) => t.trim()) : [];
        const allTickets = [...new Set([...existingTickets, ...newTickets])];
        existing.all_ticket_numbers = allTickets.join(', ');

        // Sum up tickets and amount
        existing.total_tickets += entry.number_of_tickets || 0;
        existing.total_amount_spent += parseFloat(entry.amount_spent) || 0;

        // Track if any entry is a winner
        if (entry.is_winner) {
          existing.is_winner = true;
        }

        // Track purchase dates (first and last)
        if (entry.purchase_date) {
          const newDate = new Date(entry.purchase_date);
          if (new Date(existing.first_purchase_date) > newDate) {
            existing.first_purchase_date = entry.purchase_date;
          }
          if (new Date(existing.last_purchase_date) < newDate) {
            existing.last_purchase_date = entry.purchase_date;
          }
        }

        // Collect unique transaction hashes
        if (entry.transaction_hash && entry.transaction_hash !== 'no-hash' && !existing.transaction_hashes.includes(entry.transaction_hash)) {
          existing.transaction_hashes.push(entry.transaction_hash);
        }

        // Collect all entry IDs
        existing.entry_ids.push(entry.id);

        // Track earliest expiration for pending
        if (entry.expires_at && (!existing.expires_at || new Date(entry.expires_at) < new Date(existing.expires_at))) {
          existing.expires_at = entry.expires_at;
        }
      }
    });

    // Convert to array and sort by last purchase date (most recent first)
    return Array.from(groupMap.values()).sort((a, b) => {
      return new Date(b.last_purchase_date).getTime() - new Date(a.last_purchase_date).getTime();
    });
  }, [filteredEntries]);

  // Calculate pagination based on grouped competitions (not individual entries)
  const totalPages = Math.ceil(groupedEntries.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedEntries = groupedEntries.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top of entries section
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Generate page numbers with ellipsis for many pages
  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | string)[] = [];

    if (currentPage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('...');
      pages.push(totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push(1);
      pages.push('...');
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
      pages.push('...');
      pages.push(totalPages);
    }

    return pages;
  };

  if (loading) {
    return (
      <div className="py-20">
        <Loader />
      </div>
    );
  }

  // Not logged in state
  if (!authenticated) {
    return (
      <div className="mt-10">
        <div className="text-center py-16 px-4">
          <AlertCircle size={48} className="mx-auto text-white/40 mb-4" />
          <p className="text-white/70 sequel-45 text-lg mb-2">
            Please log in to view your entries
          </p>
          <p className="text-white/50 sequel-45 text-sm">
            Connect your wallet to see your competition entries
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="mt-10">
        <div className="text-center py-16 px-4">
          <AlertCircle size={48} className="mx-auto text-[#EF008F] mb-4" />
          <p className="text-white/70 sequel-45 text-lg mb-4">
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-[#DDE404] text-black sequel-45 px-6 py-2 rounded-lg hover:bg-[#DDE404]/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 sm:mt-10">
      {/* ISSUE 9A FIX: Refreshing indicator for background data updates */}
      {isRefreshing && (
        <div className="mb-4 flex items-center justify-center gap-2 py-2 px-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <RefreshCw size={16} className="text-blue-400 animate-spin" />
          <span className="text-blue-400 sequel-45 text-sm">Updating entries...</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {paginatedEntries.length > 0 ? (
          paginatedEntries.map((entry) => {
            // Check if competition_id is a valid UUID (not a synthetic/legacy ID)
            const isValidUuid = entry.competition_id &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.competition_id);

            // For entries with valid UUIDs, make them clickable and link to the entry details page
            // For legacy/synthetic IDs, just show the card without a link
            if (isValidUuid) {
              return (
                <Link
                  to={`/dashboard/entries/competition/${entry.competition_id}`}
                  key={entry.competition_id}
                >
                  <EntriesCard
                    variant="compact"
                    showButton={false}
                    showCountDown={false}
                    activeTab={activeTab.key}
                    status={entry.status}
                    title={entry.title}
                    description={entry.description}
                    competitionImage={entry.image}
                    ticketNumbers={entry.all_ticket_numbers}
                    amountSpent={entry.total_amount_spent.toFixed(2)}
                    purchaseDate={entry.last_purchase_date}
                    transactionHash={entry.transaction_hashes.length > 0 ? entry.transaction_hashes[0] : undefined}
                    prizeValue={entry.prize_value}
                    numberOfTickets={entry.total_tickets}
                    isWinner={entry.is_winner}
                    isPending={entry.is_pending}
                    expiresAt={entry.expires_at}
                    isInstantWin={entry.is_instant_win}
                  />
                </Link>
              );
            }

            // Non-clickable card for legacy entries
            return (
              <div key={entry.competition_id}>
                <EntriesCard
                  variant="compact"
                  showButton={false}
                  showCountDown={false}
                  activeTab={activeTab.key}
                  status={entry.status}
                  title={entry.title}
                  description={entry.description}
                  competitionImage={entry.image}
                  ticketNumbers={entry.all_ticket_numbers}
                  amountSpent={entry.total_amount_spent.toFixed(2)}
                  purchaseDate={entry.last_purchase_date}
                  transactionHash={entry.transaction_hashes.length > 0 ? entry.transaction_hashes[0] : undefined}
                  prizeValue={entry.prize_value}
                  numberOfTickets={entry.total_tickets}
                  isWinner={entry.is_winner}
                  isPending={entry.is_pending}
                  expiresAt={entry.expires_at}
                  isInstantWin={entry.is_instant_win}
                />
              </div>
            );
          })
        ) : (
          <div className="col-span-2 text-center py-16 px-4">
            {activeTab.key === 'live' ? (
              <>
                <Ticket size={48} className="mx-auto text-white/40 mb-4" />
                <p className="text-white/70 sequel-45 text-lg mb-2">
                  No active entries yet
                </p>
                <p className="text-white/50 sequel-45 text-sm mb-6">
                  Enter a competition to see your entries here
                </p>
                <Link
                  to="/competitions"
                  className="inline-block bg-[#DDE404] text-black sequel-45 px-6 py-3 rounded-lg hover:bg-[#DDE404]/90 transition-colors"
                >
                  Browse Competitions
                </Link>
              </>
            ) : activeTab.key === 'pending' ? (
              <>
                <Clock size={48} className="mx-auto text-white/40 mb-4" />
                <p className="text-white/70 sequel-45 text-lg mb-2">
                  No pending reservations
                </p>
                <p className="text-white/50 sequel-45 text-sm mb-6">
                  Ticket reservations awaiting payment will appear here
                </p>
                <Link
                  to="/competitions"
                  className="inline-block bg-[#DDE404] text-black sequel-45 px-6 py-3 rounded-lg hover:bg-[#DDE404]/90 transition-colors"
                >
                  Browse Competitions
                </Link>
              </>
            ) : activeTab.key === 'instant' ? (
              <>
                <Zap size={48} className="mx-auto text-white/40 mb-4" />
                <p className="text-white/70 sequel-45 text-lg mb-2">
                  No instant win entries yet
                </p>
                <p className="text-white/50 sequel-45 text-sm mb-6">
                  Instant win competition entries will appear here
                </p>
                <Link
                  to="/competitions"
                  className="inline-block bg-[#DDE404] text-black sequel-45 px-6 py-3 rounded-lg hover:bg-[#DDE404]/90 transition-colors"
                >
                  Browse Competitions
                </Link>
              </>
            ) : (
              <>
                <Trophy size={48} className="mx-auto text-white/40 mb-4" />
                <p className="text-white/70 sequel-45 text-lg mb-2">
                  No finished competitions
                </p>
                <p className="text-white/50 sequel-45 text-sm">
                  Competitions you've entered will appear here once they're drawn
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap justify-center items-center gap-2 mt-6 sm:mt-8 px-2">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-3 sm:px-4 py-2 text-xs sm:text-sm bg-[#333] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#444] transition-colors sequel-45"
          >
            Prev
          </button>

          <div className="flex gap-1">
            {getPageNumbers().map((page, index) => (
              typeof page === 'number' ? (
                <button
                  key={index}
                  onClick={() => handlePageChange(page)}
                  className={`w-8 h-8 sm:w-10 sm:h-10 text-xs sm:text-sm rounded-lg sequel-45 transition-colors ${
                    currentPage === page
                      ? 'bg-[#DDE404] text-black'
                      : 'bg-[#333] text-white hover:bg-[#444]'
                  }`}
                >
                  {page}
                </button>
              ) : (
                <span key={index} className="w-6 sm:w-10 h-8 sm:h-10 flex items-center justify-center text-white/50 sequel-45 text-xs sm:text-sm">
                  {page}
                </span>
              )
            ))}
          </div>

          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="px-3 sm:px-4 py-2 text-xs sm:text-sm bg-[#333] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#444] transition-colors sequel-45"
          >
            Next
          </button>
        </div>
      )}

      {/* Entry count */}
      {groupedEntries.length > 0 && (
        <div className="text-center mt-3 sm:mt-4 text-white/60 sequel-45 text-xs sm:text-sm">
          Showing {startIndex + 1}-{Math.min(endIndex, groupedEntries.length)} of {groupedEntries.length} competitions
        </div>
      )}
    </div>
  );
}
