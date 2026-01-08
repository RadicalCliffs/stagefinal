import Tabs from "./UIPills";
import { scrollToSection } from "../utils/util";

const CompetitionPageTabs = () => {
  const tabList = [
    { id: "live", label: "Live Competitions" },
    { id: "instant-win", label: "Instant Win Competitions" },
    { id: "last-chance", label: "Last Chance Competitions" },
    { id: "drawn", label: "Drawn Competitions" },
  ];

  const handleTabChange = (id: string) => scrollToSection(id);

  return (
    <div className="max-w-7xl mx-auto">
      <div
        id="live-competition-tabs"
        className="xl:bg-[#3B3B3B] bg-[#202020] xl:p-3 pr-8 sm:rounded-lg sm:border-none border-y-8 border-[#3B3B3B]"
      >
        <Tabs
          tabs={tabList}
          onTabChange={handleTabChange}
          tabClasses="pb-5 sequel-45 sm:text-base text-sm"
          tabContainerClasses="space-x-4 sm:space-x-6 lg:space-x-8"
          tabOuterContainerClasses="xl:bg-[#202020] whitespace-nowrap custom-scrollbar pt-5 rounded-lg px-8"
        />
      </div>
    </div>
  );
};

export default CompetitionPageTabs;
