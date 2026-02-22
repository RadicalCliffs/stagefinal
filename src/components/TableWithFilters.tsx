import { useState, useEffect, useCallback, useRef } from "react";
import FilterTabs from "./FilterButtons";
import ActivityTable from "./ActivityTable";
import type { TableRow } from "../models/models";
import { database } from "../lib/database";
import Loader from "./Loader";
import { useSupabaseRealtimeMultiple } from "../hooks/useSupabaseRealtime";
import { useSectionTracking } from "../hooks/useSectionTracking";

const OPTIONS = [
  { label: "Live Activity", key: "live" },
  { label: "Wins", key: "wins" },
];

// Polling interval as fallback (30 seconds)
const POLLING_INTERVAL_MS = 30000;

const TableWithFilters = () => {
  const sectionRef = useSectionTracking('live_activity_section');
  const [activeTab, setActiveTab] = useState(OPTIONS[0]);
  const [tableData, setTableData] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const lastFetchRef = useRef<number>(0);
  const initialLoadDoneRef = useRef<boolean>(false);

  // Fetch activity data with deduplication
  const fetchActivity = useCallback(async (force = false) => {
    // Debounce rapid calls (within 2 seconds) unless forced
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 2000) {
      return;
    }
    lastFetchRef.current = now;

    // Only show loading on initial load
    if (!initialLoadDoneRef.current) {
      setLoading(true);
    }
    
    // Fetch more data to ensure we have enough of each type after filtering
    const limit = 50;
    const data = await database.getRecentActivity(limit);

    // Filter based on active tab:
    // - "live" tab shows BUYS only (ticket purchases) - this is "Live Activity"
    // - "wins" tab shows WINS only
    const filteredData =
      activeTab.key === "wins"
        ? data.filter((row) => row.action === "Win")
        : data.filter((row) => row.action === "Buy");

    setTableData(filteredData);
    setLoading(false);
    initialLoadDoneRef.current = true;
  }, [activeTab]);

  // Initial fetch
  useEffect(() => {
    fetchActivity(true);
  }, [activeTab]); // Re-fetch when tab changes

  // Polling fallback - realtime can silently disconnect
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('[TableWithFilters] Polling fallback - refreshing activity');
      fetchActivity();
    }, POLLING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchActivity]);

  // Subscribe to realtime updates for joincompetition (the actual source table for entries) and winners
  useSupabaseRealtimeMultiple([
    {
      table: 'joincompetition',
      handlers: {
        onInsert: () => {
          console.log('[TableWithFilters] New entry in joincompetition, refreshing activity');
          fetchActivity();
        },
        onUpdate: () => {
          console.log('[TableWithFilters] Entry updated in joincompetition, refreshing activity');
          fetchActivity();
        }
      }
    },
    {
      table: 'competition_entries',
      handlers: {
        onInsert: () => {
          console.log('[TableWithFilters] New competition_entry detected, refreshing activity');
          fetchActivity();
        }
      }
    },
    {
      table: 'winners',
      handlers: {
        onInsert: () => {
          console.log('[TableWithFilters] New winner detected, refreshing activity');
          fetchActivity();
        }
      }
    }
  ]);

  if (loading) {
    return (
      <div className="py-20">
        <Loader />
      </div>
    );
  }

  return (
    <div ref={sectionRef} className=" md:bg-inherit bg-[#131313] rounded-md md:pt-0 pt-6 relative z-10 ">
      <FilterTabs
        options={OPTIONS}
        active={activeTab}
        onChange={setActiveTab}
        containerClasses="flex justify-center gap-4 md:mb-8"
        buttonClasses="md:min-w-[260px] min-w-[110px] md:!text-lg !text-sm sequel-95 !px-4 "
      />
      {/* Use ActivityTable for both Live Activity and Wins tabs */}
      <ActivityTable data={tableData} />
    </div>
  );
};

export default TableWithFilters;
