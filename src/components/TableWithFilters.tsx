import { useState, useMemo } from "react";
import FilterTabs from "./FilterButtons";
import ActivityTable from "./ActivityTable";
import type { TableRow } from "../models/models";
import { database } from "../lib/database";
import Loader from "./Loader";
import { useLiveData } from "../hooks/useLiveData";
import { useSectionTracking } from "../hooks/useSectionTracking";

const OPTIONS = [
  { label: "Live Activity", key: "live" },
  { label: "Wins", key: "wins" },
];

// Tables that affect live activity data
const ACTIVITY_TABLES = ["joincompetition", "competition_entries", "winners"];

const TableWithFilters = () => {
  const sectionRef = useSectionTracking("live_activity_section");
  const [activeTab, setActiveTab] = useState(OPTIONS[0]);

  // Fetch all activity data with realtime updates
  const { data: allData, loading } = useLiveData({
    fetchFn: () => database.getRecentActivity(50),
    tables: ACTIVITY_TABLES,
    channelName: "live-activity",
  });

  // Filter based on active tab
  const tableData = useMemo(() => {
    if (!allData) return [];
    return activeTab.key === "wins"
      ? allData.filter((row: TableRow) => row.action === "Win")
      : allData.filter((row: TableRow) => row.action === "Buy");
  }, [allData, activeTab]);

  if (loading) {
    return (
      <div className="py-20">
        <Loader />
      </div>
    );
  }

  return (
    <div
      ref={sectionRef}
      className=" md:bg-inherit bg-[#131313] rounded-md md:pt-0 pt-6 relative z-10 "
    >
      <FilterTabs
        options={OPTIONS}
        active={activeTab}
        onChange={setActiveTab}
        containerClasses="flex justify-center gap-4 md:mb-8"
        buttonClasses="md:min-w-[260px] min-w-[110px] md:!text-lg !text-sm sequel-95 !px-4 "
      />
      <ActivityTable data={tableData} />
    </div>
  );
};

export default TableWithFilters;
