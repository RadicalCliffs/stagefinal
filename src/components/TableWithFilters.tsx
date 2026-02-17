import { useState, useEffect, useCallback } from "react";
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

const TableWithFilters = () => {
  const sectionRef = useSectionTracking('live_activity_section');
  const [activeTab, setActiveTab] = useState(OPTIONS[0]);
  const [tableData, setTableData] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch activity data
  const fetchActivity = useCallback(async () => {
    setLoading(true);
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
  }, [activeTab]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Subscribe to realtime updates for tickets, user_transactions, balance_ledger, and winners
  useSupabaseRealtimeMultiple([
    {
      table: 'tickets',
      handlers: {
        onInsert: () => {
          console.log('[TableWithFilters] New ticket detected, refreshing activity');
          fetchActivity();
        }
      }
    },
    {
      table: 'user_transactions',
      handlers: {
        onInsert: () => {
          console.log('[TableWithFilters] New transaction detected, refreshing activity');
          fetchActivity();
        }
      }
    },
    {
      table: 'balance_ledger',
      handlers: {
        onInsert: () => {
          console.log('[TableWithFilters] New balance ledger entry, refreshing activity');
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
