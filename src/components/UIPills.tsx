import { useEffect, useState } from "react";
import type { TabsProps } from "../models/models";
import { useLocation } from "react-router";

const Tabs: React.FC<TabsProps> = ({ tabs, onTabChange, tabContainerClasses, tabClasses, tabOuterContainerClasses, activeTabClasses }) => {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id);
  const location = useLocation();

  // Update active tab when URL changes
  useEffect(() => {
    const currentPath = location.pathname.split("/").pop();
    const matchingTab = tabs.find((t) => t.id === currentPath);
    if (matchingTab) {
      setActiveTab(matchingTab.id);
    }
  }, [location.pathname, tabs]);

  const handleClick = (id: string) => {
    setActiveTab(id);
    onTabChange?.(id);
  };

  return (
    <div className={`w-full overflow-x-auto ${tabOuterContainerClasses || ''}`}>
      <div className={`flex ${tabContainerClasses || 'space-x-12'}`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleClick(tab.id)}
            className={`pb-3 cursor-pointer uppercase whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? `text-white sequel-75 border-b-4 border-[#DDE404] ${activeTabClasses || ''}`
                : "text-white"
            } ${tabClasses || ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Tabs;
