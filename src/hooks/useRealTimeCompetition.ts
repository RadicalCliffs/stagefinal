import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Competition } from '../models/models';
import { useTicketBroadcast, type TicketBroadcastEvent, type TicketStats } from './useTicketBroadcast';

interface UseRealTimeCompetitionOptions {
  competitionId: string;
  onTicketsSoldUpdate?: (ticketsSold: number, totalTickets: number) => void;
  onStatusChange?: (newStatus: string) => void;
  onWinnerAnnounced?: (winnerAddress: string) => void;
  /** Use broadcast channel for instant ticket updates (default: true) */
  useBroadcast?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

interface RealTimeCompetitionState {
  competition: Competition | null;
  ticketsSold: number;
  totalTickets: number;
  percentageSold: number;
  availableTickets: number;
  pendingTickets: number;
  status: string;
  isLoading: boolean;
  error: string | null;
  lastUpdate: Date | null;
  /** Whether broadcast channel is subscribed */
  isBroadcastSubscribed: boolean;
}

/**
 * Real-time competition hook with Supabase subscriptions
 *
 * Provides live updates for:
 * - Ticket sales count (via broadcast channel for instant updates)
 * - Competition status changes
 * - Winner announcements
 *
 * Uses a hybrid approach:
 * - Broadcast channel for instant ticket updates (ticket_reserved, ticket_sold, etc.)
 * - Postgres changes for competition status and winner announcements
 */
export function useRealTimeCompetition(options: UseRealTimeCompetitionOptions): RealTimeCompetitionState & {
  refresh: () => Promise<void>;
} {
  const {
    competitionId,
    onTicketsSoldUpdate,
    onStatusChange,
    onWinnerAnnounced,
    useBroadcast = true,
    debug = false,
  } = options;

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [ticketsSold, setTicketsSold] = useState(0);
  const [pendingTickets, setPendingTickets] = useState(0);
  const [totalTickets, setTotalTickets] = useState(0);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Track previous values for callbacks
  const prevTicketsSoldRef = useRef<number>(0);
  const prevStatusRef = useRef<string>('');

  const log = useCallback(
    (...args: unknown[]) => {
      if (debug) {
        console.log('[RealTimeCompetition]', ...args);
      }
    },
    [debug]
  );

  // Handle broadcast events for instant ticket updates
  const handleBroadcastEvent = useCallback(
    (event: TicketBroadcastEvent) => {
      log('Broadcast event received:', event.event, event.stats);

      if (event.stats) {
        const { sold_count, pending_count, total_tickets: total, available_count } = event.stats;

        setTicketsSold(sold_count);
        setPendingTickets(pending_count);
        if (total > 0) {
          setTotalTickets(total);
        }
        setLastUpdate(new Date());

        // Trigger callback if sold count changed
        if (sold_count !== prevTicketsSoldRef.current && onTicketsSoldUpdate) {
          onTicketsSoldUpdate(sold_count, total);
        }
        prevTicketsSoldRef.current = sold_count;
      }
    },
    [onTicketsSoldUpdate, log]
  );

  // Subscribe to broadcast channel for ticket events
  const { isSubscribed: isBroadcastSubscribed } = useTicketBroadcast({
    competitionId: useBroadcast ? competitionId : '',
    onEvent: handleBroadcastEvent,
    debug,
  });

  const fetchCompetition = useCallback(async () => {
    if (!competitionId) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('competitions')
        .select('*')
        .eq('id', competitionId)
        .single();

      if (fetchError) throw fetchError;

      if (data) {
        setCompetition(data as Competition);
        setTotalTickets(data.total_tickets || 0);
        setStatus(data.status || 'active');

        // Get current tickets sold count from tickets table
        const { data: ticketData } = await supabase
          .from('tickets')
          .select('id')
          .eq('competition_id', competitionId);

        // Get pending tickets count
        const { count: pendingCount } = await supabase
          .from('pending_tickets')
          .select('id', { count: 'exact' })
          .eq('competition_id', competitionId)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString());

        // Use tickets table count as authoritative
        const sold = ticketData?.length || data.tickets_sold || 0;
        setTicketsSold(sold);
        setPendingTickets(pendingCount || 0);

        // Call callback if tickets changed
        if (sold !== prevTicketsSoldRef.current && onTicketsSoldUpdate) {
          onTicketsSoldUpdate(sold, data.total_tickets || 0);
        }
        prevTicketsSoldRef.current = sold;

        // Call callback if status changed
        if (data.status !== prevStatusRef.current && prevStatusRef.current && onStatusChange) {
          onStatusChange(data.status);
        }
        prevStatusRef.current = data.status || '';

        // Check for winner
        if (data.winner_address && onWinnerAnnounced) {
          onWinnerAnnounced(data.winner_address);
        }

        setLastUpdate(new Date());
        setError(null);
      }
    } catch (err) {
      console.error('Error fetching competition:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch competition');
    } finally {
      setIsLoading(false);
    }
  }, [competitionId, onTicketsSoldUpdate, onStatusChange, onWinnerAnnounced]);

  useEffect(() => {
    if (!competitionId) return;

    // Initial fetch
    fetchCompetition();

    // Set up real-time subscription for competition updates (status, winner)
    // Note: Ticket updates are handled by broadcast channel when useBroadcast=true
    const channel = supabase
      .channel(`competition-status-${competitionId}`)
      // Listen for competition updates (status changes, winner)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'competitions',
          filter: `id=eq.${competitionId}`,
        },
        (payload) => {
          log('Competition update via postgres_changes:', payload);
          fetchCompetition();
        }
      )
      .subscribe();

    // Only subscribe to ticket table changes if broadcast is disabled
    let ticketChannel: ReturnType<typeof supabase.channel> | null = null;
    if (!useBroadcast) {
      ticketChannel = supabase
        .channel(`competition-tickets-fallback-${competitionId}`)
        // Listen for ticket purchases
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'joincompetition',
            filter: `competitionid=eq.${competitionId}`,
          },
          (payload) => {
            log('New entry via postgres_changes:', payload);
            fetchCompetition();
          }
        )
        // Listen for tickets table updates
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'tickets',
            filter: `competition_id=eq.${competitionId}`,
          },
          (payload) => {
            log('New ticket via postgres_changes:', payload);
            fetchCompetition();
          }
        )
        // Listen for pending ticket changes (reservations)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'pending_tickets',
            filter: `competition_id=eq.${competitionId}`,
          },
          () => {
            fetchCompetition();
          }
        )
        .subscribe();
    }

    return () => {
      supabase.removeChannel(channel);
      if (ticketChannel) {
        supabase.removeChannel(ticketChannel);
      }
    };
  }, [competitionId, fetchCompetition, useBroadcast, log]);

  const percentageSold = totalTickets > 0 ? Math.round((ticketsSold / totalTickets) * 100) : 0;
  // Available tickets excludes both sold and pending
  const availableTickets = Math.max(0, totalTickets - ticketsSold - pendingTickets);

  return {
    competition,
    ticketsSold,
    totalTickets,
    percentageSold,
    availableTickets,
    pendingTickets,
    status,
    isLoading,
    error,
    lastUpdate,
    isBroadcastSubscribed,
    refresh: fetchCompetition,
  };
}

/**
 * Real-time ticket counter component hook
 * Optimized for displaying live ticket sales counts
 *
 * Now uses broadcast channel for instant updates without polling.
 */
export function useTicketSalesCounter(competitionId: string) {
  const {
    ticketsSold,
    totalTickets,
    percentageSold,
    availableTickets,
    pendingTickets,
    isLoading,
    isBroadcastSubscribed,
    refresh,
  } = useRealTimeCompetition({ competitionId });

  return {
    ticketsSold,
    totalTickets,
    percentageSold,
    availableTickets,
    pendingTickets,
    isLoading,
    isBroadcastSubscribed,
    refresh,
    // Formatted strings for display
    formattedSold: `${ticketsSold.toLocaleString()} / ${totalTickets.toLocaleString()}`,
    formattedAvailable: availableTickets.toLocaleString(),
    formattedPercentage: `${percentageSold}%`,
    isSoldOut: availableTickets === 0,
    isAlmostSoldOut: percentageSold >= 90,
    isHalfSold: percentageSold >= 50,
  };
}

export default useRealTimeCompetition;
