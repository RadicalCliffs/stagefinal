import Tabs from "./UIPills";

const LandingPageTabs = () => {
  const tabList = [
    { label: "All Competitions", id: "all" },
    { label: "Bitcoin", id: "bitcoin" },
    { label: "Cars & Watches", id: "car-watches" },
    { label: "Instant Wins", id: "instant-wins" },
    { label: "High Rollers", id: "high-rollers" },
    { label: "Nft's", id: "nft" },
    { label: "Alt Coins", id: "alt-coins" },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div id="live-competition-tabs" className="pr-3">
        <Tabs
          tabs={tabList}
          onTabChange={() => {}}
          tabClasses="pb-1 sequel-45 sm:text-base text-xs"
          activeTabClasses="!border-b-2"
          tabContainerClasses="!space-x-6"
          tabOuterContainerClasses="xl:bg-[#202020] whitespace-nowrap custom-scrollbar px-0 "
        />
      </div>
    </div>
  );
};

export default LandingPageTabs;
