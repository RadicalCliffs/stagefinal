import { useState, useEffect, useCallback } from "react";
import FilterTabs from "./FilterButtons";
import ActivityTable from "./ActivityTable";
import WinsCompetitionCard from "./WinsCompetitionCard";
import type { TableRow } from "../models/models";
import { database } from "../lib/database";
import Loader from "./Loader";
import { useSupabaseRealtimeMultiple } from "../hooks/useSupabaseRealtime";

const OPTIONS = [
  { label: "Live Activity", key: "live" },
  { label: "Wins", key: "wins" },
];

const TableWithFilters = () => {
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
    // - "live" tab shows ENTRIES only (ticket purchases) - this is "Live Activity"
    // - "wins" tab shows WINS only
    const filteredData =
      activeTab.key === "wins"
        ? data.filter((row) => row.action === "Win")
        : data.filter((row) => row.action === "Entry");

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
    <div className=" md:bg-inherit bg-[#131313] rounded-md md:pt-0 pt-6 relative z-10 ">
      <FilterTabs
        options={OPTIONS}
        active={activeTab}
        onChange={setActiveTab}
        containerClasses="flex justify-center gap-4 md:mb-8"
        buttonClasses="md:min-w-[260px] min-w-[110px] md:!text-lg !text-sm sequel-95 !px-4 "
      />
      {activeTab.key === "wins" ? (
        <div className="w-full max-w-7xl mx-auto mb-4 md:py-0 py-6">
          <div className="grid 2xl:grid-cols-4 lg:grid-cols-3 sm:grid-cols-2 grid-cols-1 gap-6 px-4">
            {tableData.map((row, idx) => (
              <WinsCompetitionCard
                key={idx}
                id={row.competitionId || ""}
                image={row.competitionImage || ""}
                title={row.competition}
                prize={row.competitionPrize || row.amount}
                winner={row.user}
                date={row.time}
              />
            ))}
          </div>
          {tableData.length === 0 && (
            <p className="text-white/70 text-center py-12 sequel-45">
              No recent wins to display
            </p>
          )}
        </div>
      ) : (
        <ActivityTable data={tableData} />
      )}
    </div>
  );
};

export default TableWithFilters;
