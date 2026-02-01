// EntriesLayout.tsx
import { Outlet } from 'react-router';
import { useState } from 'react';
import FilterTabs from '../../FilterButtons';
import Heading from '../../Heading';
import type { Options } from '../../../models/models';

const OPTIONS:Options[] = [
  { label: 'Purchases', key: 'purchases' },
  { label: 'Transactions', key: 'entries' },
];

export default function OrdersLayout() {
  const [activeTab, setActiveTab] = useState(OPTIONS[0]);

  return (
    <div>
      <Heading text='My Orders' classes='text-white sequel-95' />
       <p className='sequel-45 text-white text-center md:mt-4 mt-3 md:leading-relaxed leading-relaxed md:w-10/12 w-11/12 mx-auto md:text-base text-sm'>Click on the order amount to view more information</p>
      <div className='bg-[#151515] xl:p-10 md:p-8 p-4 sm:p-5 rounded-lg md:mt-8 mt-6'>
        <FilterTabs
          options={OPTIONS}
          active={activeTab}
          onChange={setActiveTab}
          containerClasses='grid md:grid-cols-2 grid-cols-2 md:gap-6 gap-2 sm:gap-4'
          buttonClasses='!text-xs sm:!text-sm !sequel-75 py-3 sm:py-4'
        />
        <div className='md:mt-10 mt-6'>
            <Outlet context={{ activeTab }} />
        </div>
      </div>
    </div>
  );
}
