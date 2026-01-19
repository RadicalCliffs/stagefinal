import { useNavigate } from "react-router";
import Tabs from "../UIPills";
import UserMiniProfile from "./UserMiniProfile";
import { useState, lazy, Suspense } from "react";
import { useAuthUser } from "../../contexts/AuthContext";

// Lazy load TopUpWalletModal - only loaded when user clicks "Top Up Balance"
const TopUpWalletModal = lazy(() => import("../TopUpWalletModal"));


const DashboardTabs = () => {
    const navigate = useNavigate()
    const [showTopUpModal, setShowTopUpModal] = useState(false);
    const { refreshUserData } = useAuthUser();

    const tabList = [
        { id: 'entries', label: 'Entries' },
        { id: 'wallet', label: 'Wallet' },
        { id: 'orders', label: 'Orders' },
        { id: 'notifications', label: 'Notifications' },
        { id: 'promo', label: 'Promo' },
        { id: 'account', label: 'Account' },
    ];

    const handleTabChange = (id: string) => navigate(`/dashboard/${id}`)

    const handleTopUpSuccess = () => {
        refreshUserData();
        setShowTopUpModal(false);
    };

    return (
        <>
            <div className='max-w-7xl mx-auto custom-box-shadow'>
                <div id='live-competition-tabs' className='xl:bg-[#3B3B3B] bg-[#202020] rounded-lg overflow-hidden'>
                    {/* Top section with profile and top-up button - improved mobile layout */}
                    <div className='flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 p-3 sm:p-4 md:p-5'>
                        {/* User Profile */}
                        <div className="flex-1 min-w-0 w-full sm:w-auto">
                            <UserMiniProfile />
                        </div>

                        {/* Top Up Button - full width on mobile, auto width on desktop */}
                        <div className="flex-shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                            <button
                                onClick={() => setShowTopUpModal(true)}
                                className="uppercase text-xs sm:text-sm hover:bg-white/90 sequel-75 bg-white text-[#181818] border border-white rounded-sm py-2.5 sm:py-3 px-4 sm:px-6 whitespace-nowrap w-full sm:w-auto transition-colors active:scale-[0.98]"
                            >
                                Top Up Balance
                            </button>
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

            {showTopUpModal && (
                <Suspense fallback={null}>
                    <TopUpWalletModal
                        isOpen={showTopUpModal}
                        onClose={() => setShowTopUpModal(false)}
                        onSuccess={handleTopUpSuccess}
                    />
                </Suspense>
            )}
        </>
    )
}

export default DashboardTabs
