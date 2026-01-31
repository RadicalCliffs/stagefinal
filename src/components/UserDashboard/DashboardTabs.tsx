import { useNavigate } from "react-router";
import Tabs from "../UIPills";
import UserMiniProfile from "./UserMiniProfile";


const DashboardTabs = () => {
    const navigate = useNavigate()

    const tabList = [
        { id: 'entries', label: 'Entries' },
        { id: 'wallet', label: 'Wallet' },
        { id: 'orders', label: 'Orders' },
        { id: 'notifications', label: 'Notifications' },
        { id: 'promo', label: 'Promo' },
        { id: 'account', label: 'Account' },
    ];

    const handleTabChange = (id: string) => navigate(`/dashboard/${id}`)

    return (
        <>
            <div className='max-w-7xl mx-auto custom-box-shadow'>
                <div id='live-competition-tabs' className='xl:bg-[#3B3B3B] bg-[#202020] rounded-lg'>
                    {/* Top section with profile - full width for larger avatar */}
                    <div className='p-3 sm:p-4 md:p-5'>
                        {/* User Profile */}
                        <div className="w-full">
                            <UserMiniProfile />
                        </div>
                    </div>

                    {/* Tabs section - improved scrolling on mobile */}
                    <div className="border-t border-[#3A3A3A] xl:bg-[#202020]">
                        <Tabs
                            tabs={tabList}
                            onTabChange={handleTabChange}
                            tabClasses="py-2.5 sm:py-3 md:py-4 sequel-45 text-[11px] sm:text-xs md:text-sm lg:text-base"
                            tabContainerClasses='flex gap-3 sm:gap-4 md:gap-6 lg:gap-8 xl:gap-10 justify-start px-3 sm:px-4 md:px-6 overflow-x-auto'
                            tabOuterContainerClasses='custom-scrollbar w-full -webkit-overflow-scrolling-touch'
                            activeTabClasses="!text-[#DDE404]"
                        />
                    </div>
                </div>
            </div>
        </>
    )
}

export default DashboardTabs
