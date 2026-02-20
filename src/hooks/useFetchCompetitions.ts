import { useCallback, useEffect, useState } from "react";
import type { Competition } from "../models/models";
import { database } from "../lib/database";
import { supabase } from "../lib/supabase";
import {
  isCompetitionVisible,
  DASHBOARD_CONFIG,
} from "../lib/appConfig";

// ISSUE #5 FIX: Use centralized configuration for refresh interval
const REFRESH_INTERVAL_MS = DASHBOARD_CONFIG.COMPETITION_REFRESH_INTERVAL_MS;

// ISSUE #5 FIX: Use centralized visibility check function
// This ensures consistent filtering across the application
const isAfterVisibilityCutoff = (comp: Competition): boolean => {
  return isCompetitionVisible(comp.created_at);
};

export function useCompetitions() {
  const [liveCompetitions, setLiveCompetitions] = useState<Competition[]>([]);
  const [instantWinCompetitions, setInstantWinCompetitions] = useState<Competition[]>([]);
  const [lastChanceCompetitions, setLastChanceCompetitions] = useState<Competition[]>([]);
  const [drawnCompetitions, setDrawnCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  const fetchCompetitions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch all competition statuses with high limit to get all competitions
      // The frontend handles pagination, so we need all data available
      const [allActive, allCompleted, allDrawing, allCancelled, allDrawn] = await Promise.all([
        database.getCompetitionsV2("active", 100),
        database.getCompetitionsV2("completed", 100),
        database.getCompetitionsV2("drawing", 100),
        database.getCompetitionsV2("cancelled", 100),
        database.getCompetitionsV2("drawn", 100),
      ]);

      // Apply visibility cutoff filter to all fetched competitions
      // Only competitions created after COMPETITION_VISIBILITY_CUTOFF will be displayed
      const activeComps = ((allActive ?? []) as any[]).filter((c): c is any => c !== null && isAfterVisibilityCutoff(c));
      const completedComps = ((allCompleted ?? []) as any[]).filter((c): c is any => c !== null && isAfterVisibilityCutoff(c));
      const drawingComps = ((allDrawing ?? []) as any[]).filter((c): c is any => c !== null && isAfterVisibilityCutoff(c));
      const cancelledComps = ((allCancelled ?? []) as any[]).filter((c): c is any => c !== null && isAfterVisibilityCutoff(c));
      const drawnCompsRaw = ((allDrawn ?? []) as any[]).filter((c): c is any => c !== null && isAfterVisibilityCutoff(c));

      const now = new Date();

      // Filter out competitions that have ended (end_date has passed)
      // These should be shown in "drawn" section even if status hasn't been updated yet
      // Also filter out sold-out competitions
      const stillActiveComps = activeComps.filter(comp => {
        // Check if sold out
        const isSoldOut = (comp.total_tickets || 0) > 0 && (comp.tickets_sold || 0) >= (comp.total_tickets || 0);
        if (isSoldOut) return false; // Move sold-out to drawn section

        if (!comp.end_date) return true; // No end date = still active
        const endDate = new Date(comp.end_date);
        return endDate > now; // Only include if end date is in the future
      });

      // Competitions that are "active" but have passed their end_date OR are sold out
      const expiredActiveComps = activeComps.filter(comp => {
        // Check if sold out
        const isSoldOut = (comp.total_tickets || 0) > 0 && (comp.tickets_sold || 0) >= (comp.total_tickets || 0);
        if (isSoldOut) return true; // Include sold-out competitions

        if (!comp.end_date) return false;
        const endDate = new Date(comp.end_date);
        return endDate <= now;
      });

      // Live competitions (not instant win, still active)
      const liveComps = stillActiveComps.filter(comp => !comp.is_instant_win);
      
      // Instant win competitions (still active and not expired)
      const instantWinComps = stillActiveComps.filter(comp => {
        if (!comp.is_instant_win) return false;
        // Double-check that instant win competitions haven't expired
        if (!comp.end_date) return true;
        const endDate = new Date(comp.end_date);
        return endDate > now;
      });

      // Last chance: competitions ending within 24 hours
      const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const lastChanceComps = stillActiveComps.filter(comp => {
        if (!comp.end_date) return false;
        const endDate = new Date(comp.end_date);
        return endDate <= twentyFourHoursFromNow && endDate > now;
      });

      // Drawn competitions: completed + drawing + drawn + cancelled + expired active comps (including instant wins)
      // Note: All arrays are already filtered by COMPETITION_VISIBILITY_CUTOFF
      const drawnComps = [
        ...completedComps,
        ...drawingComps,
        ...drawnCompsRaw,
        ...expiredActiveComps, // Include all expired "active" competitions (standard and instant win)
      ];

      setLiveCompetitions(liveComps as Competition[]);
      setInstantWinCompetitions(instantWinComps as Competition[]);
      setLastChanceCompetitions(lastChanceComps as Competition[]);
      setDrawnCompetitions(drawnComps as Competition[]);
      setLastUpdate(Date.now());
    } catch (err: any) {
      console.error("Error fetching competitions:", err);
      setError(err.message ?? "Failed to fetch competitions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompetitions();
  }, [fetchCompetitions]);

  // Refresh data periodically to prevent stale data (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      // Only refresh if the tab is visible to prevent unnecessary network requests
      if (document.visibilityState === 'visible') {
        fetchCompetitions();
      }
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchCompetitions]);

  useEffect(() => {
    // Keep competition lists in sync with Supabase in real time
    const channel = supabase
      .channel("competitions-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competitions" },
        () => fetchCompetitions()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "v_joincompetition_active" },
        () => fetchCompetitions()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pending_tickets" },
        () => fetchCompetitions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchCompetitions]);

  /**
   * Optimistic update for competition status
   * Updates local state immediately, then verifies with server
   */
  const updateCompetitionStatus = useCallback((competitionId: string, newStatus: string) => {
    // Helper to update competition in an array
    const updateInArray = (comps: Competition[]) =>
      comps.map(comp =>
        comp.id === competitionId ? { ...comp, status: newStatus } : comp
      );

    // Update all competition arrays optimistically
    setLiveCompetitions(prev => updateInArray(prev) as Competition[]);
    setInstantWinCompetitions(prev => updateInArray(prev) as Competition[]);
    setLastChanceCompetitions(prev => updateInArray(prev) as Competition[]);
    setDrawnCompetitions(prev => updateInArray(prev) as Competition[]);

    // Verify update with server and rollback on failure
    (supabase
      .from('competitions') as any)
      .update({ status: newStatus } as any)
      .eq('id', competitionId)
      .then(({ error }: any) => {
        if (error) {
          console.error('Failed to update competition status:', error);
          // Rollback by refetching
          fetchCompetitions();
        }
      });
  }, [fetchCompetitions]);

  return {
    liveCompetitions,
    instantWinCompetitions,
    lastChanceCompetitions,
    drawnCompetitions,
    loading,
    error,
    refetch: fetchCompetitions,
    lastUpdate,
    updateCompetitionStatus,
  };
}