// EntriesLayout.tsx
import { Outlet } from 'react-router';
import { useState } from 'react';
import FilterTabs from '../../FilterButtons';
import Heading from '../../Heading';
import type { Options } from '../../../models/models';

const OPTIONS:Options[] = [
  { label: 'Live Competitions', key: 'live' },
  { label: 'Finished Competitions', key: 'finished' },
  { label: 'Instant Wins', key: 'instant' },
  { label: 'Pending Reservations', key: 'pending' },
];

export default function EntriesLayout() {
  const [activeTab, setActiveTab] = useState(OPTIONS[0]);

  return (
    <div>
      <Heading text='My Entries' classes='text-white sequel-95' />
      <div className='bg-[#151515] xl:p-10 md:p-8 p-4 sm:p-5 rounded-lg md:mt-8 mt-6'>
        <FilterTabs
          options={OPTIONS}
          active={activeTab}
          onChange={setActiveTab}
          containerClasses='grid md:grid-cols-4 grid-cols-2 md:gap-6 gap-2 sm:gap-4'
          buttonClasses='!text-[10px] sm:!text-xs md:!text-sm !sequel-75 py-3 sm:py-4'
        />
        {/* Detail and List will both render here */}
        <Outlet context={{ activeTab }} />
      </div>
    </div>
  );
}
