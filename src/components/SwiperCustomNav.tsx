import { ChevronLeftCircle, ChevronRightCircle } from 'lucide-react';
import { useSwiper } from 'swiper/react';
import { SwiperBarPagination } from './SwiperCustomPaginatin';

export const SwiperNavButtons = () => {
  const swiper = useSwiper();

  return (
    <div className="flex items-center justify-center w-full gap-4 ">
      <button onClick={() => swiper.slidePrev()}><ChevronLeftCircle size={21} className='cursor-pointer max-[410px]:hidden'/></button>
      <SwiperBarPagination />
      <button onClick={() => swiper.slideNext()}><ChevronRightCircle size={21} className='cursor-pointer max-[410px]:hidden'/></button>
    </div>
  );
};
