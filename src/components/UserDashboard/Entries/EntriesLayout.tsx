// EntriesLayout.tsx
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useState } from 'react';
import FilterTabs from '../../FilterButtons';
import Heading from '../../Heading';
import type { Options } from '../../../models/models';

const OPTIONS:Options[] = [
  { label: 'Live Competitions', key: 'live' },
  { label: 'Finished Competitions', key: 'finished' },
  { label: 'Instant Wins', key: 'instant' },
];

export default function EntriesLayout() {
  const [activeTab, setActiveTab] = useState(OPTIONS[0]);
  const location = useLocation();
  const navigate = useNavigate();
  const isDetailView = location.pathname.includes('/dashboard/entries/competition/');

  return (
    <div>
      <Heading text='My Entries' classes='text-white sequel-95' />
      <div className='bg-[#151515] xl:p-10 md:p-8 p-4 sm:p-5 rounded-lg md:mt-8 mt-6'>
        {isDetailView ? (
          <div className='grid md:grid-cols-4 grid-cols-2 md:gap-6 gap-2 sm:gap-4'>
            <button
              onClick={() => {
                setActiveTab(OPTIONS[0]);
                navigate('/dashboard/entries');
              }}
              className='py-3 px-3 sm:px-4 lg:px-6 lg:text-sm md:text-xs text-[11px] uppercase rounded-lg cursor-pointer transition-all duration-200 leading-tight bg-[#DDE404] sequel-75 text-[#1A1A1A] border-2 border-[#DDE404] shadow-lg shadow-[#DDE404]/20 !text-[10px] sm:!text-xs md:!text-sm !sequel-75 py-3 sm:py-4'
            >
              Finished Competitions
            </button>
          </div>
        ) : (
          <FilterTabs
            options={OPTIONS}
            active={activeTab}
            onChange={setActiveTab}
            containerClasses='grid md:grid-cols-4 grid-cols-2 md:gap-6 gap-2 sm:gap-4'
            buttonClasses='!text-[10px] sm:!text-xs md:!text-sm !sequel-75 py-3 sm:py-4'
          />
        )}
        {/* Detail and List will both render here */}
        <Outlet context={{ activeTab }} />
      </div>
    </div>
  );
}
