import Tabs from '../UIPills';

const InstantWinTabs = () => {
  const tabList = [
    { id: 'instant-win', label: 'Instant Win Prizes' },
    { id: 'competition-details', label: 'Competition Details' },
    { id: 'faq', label: 'FAQ' },
  ];

  const handleTabChange = (id: string) => {
    console.log('Active tab:', id);
  };

  return (
    <div className='max-w-6xl mx-auto text-center py-10 px-4 space-y-3'>
      {/* Scrollable wrapper */}
      <div id='ui-pills' className='flex items-baseline custom-scrollbar justify-normal lg:justify-center gap-6 sm:gap-12 overflow-x-auto whitespace-nowrap'>
        {/* Tabs */}
        <div className='flex-shrink-0'>
          <Tabs
            tabs={tabList}
            onTabChange={handleTabChange}
            tabContainerClasses='justify-center'
            tabClasses='text-lg sequel-75'
          />
        </div>

        {/* Buy Tickets Button */}
        <div className='flex-shrink-0'>
          <button className='border border-white cursor-pointer hover:bg-[#DDE404]/90 text-lg bg-[#DDE404] text-[#2D2022] sequel-95 rounded-md py-2 px-4 custom-box-shadow uppercase whitespace-nowrap'>
            Buy Tickets
          </button>
        </div>
      </div>

      {/* Sandbox Notice */}
      <div className='bg-orange-500/10 border border-orange-500/30 rounded-lg px-4 py-2.5 max-w-4xl mx-auto'>
        <p className='text-orange-400 text-xs sequel-45 text-center'>
          ⚠️ SANDBOX MODE: Transactions will not be called on-chain. This feature is ready to deploy alongside production.
        </p>
      </div>
    </div>
  );
};

export default InstantWinTabs;
