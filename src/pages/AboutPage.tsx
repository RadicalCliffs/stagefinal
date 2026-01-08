import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, A11y } from 'swiper/modules';
import 'swiper/swiper-bundle.css';
import { SwiperNavButtons } from '../components/SwiperCustomNav';

const SUPABASE_STORAGE_URL = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Web%20Assets/All%20Website%20Images';

const AboutPage = () => {
  const desktopFrames = [
    `${SUPABASE_STORAGE_URL}/About%20-%20Frame%201.png`,
    `${SUPABASE_STORAGE_URL}/About%20-%20Frame%202.png`,
    `${SUPABASE_STORAGE_URL}/About%20-%20Frame%203.png`,
    `${SUPABASE_STORAGE_URL}/About%20-%20Frame%204.png`,
    `${SUPABASE_STORAGE_URL}/About%20-%20Frame%205.png`,
  ];

  const mobileFrames = [
    `${SUPABASE_STORAGE_URL}/About%20-%20Mobile%201.png`,
    `${SUPABASE_STORAGE_URL}/About%20-%20Mobile%202.png`,
    `${SUPABASE_STORAGE_URL}/About%20-%20Mobile%203.png`,
  ];

  const mobileCarousel = [
    `${SUPABASE_STORAGE_URL}/About%20-%20Mobile%204.1.png`,
    `${SUPABASE_STORAGE_URL}/About%20-%20Mobile%204.2.png`,
    `${SUPABASE_STORAGE_URL}/About%20-%20Mobile%204.3.png`,
  ];

  return (
    <>
      <div className="custom-landing-page-background bg-full-size absolute inset-0 w-full h-full"></div>
      <div className="relative">

        <div className="hidden md:block">
          <div className="max-w-7xl mx-auto space-y-[4.6rem]">
            {desktopFrames.map((frame, index) => (
              <div key={index} className="w-full py-[2.3rem]">
                <img
                  src={frame}
                  alt={`About section ${index + 1}`}
                  className="w-full h-auto object-contain"
                  loading={index === 0 ? "eager" : "lazy"}
                  style={{ imageRendering: 'auto' }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="md:hidden">
          <div className="space-y-[3.45rem]">
            {mobileFrames.map((frame, index) => (
              <div key={index} className="w-full py-[1.725rem]">
                <img
                  src={frame}
                  alt={`About section ${index + 1}`}
                  className="w-full h-auto object-contain"
                  loading={index === 0 ? "eager" : "lazy"}
                  style={{ imageRendering: 'auto' }}
                />
              </div>
            ))}

            <div className="w-full py-[3.68rem] bg-gradient-to-br from-pink-600 via-purple-700 to-[#1A1A1A]">
              <Swiper
                modules={[Navigation, Pagination, A11y]}
                spaceBetween={20}
                slidesPerView={1}
                loop
                className="pb-12 px-4"
              >
                {mobileCarousel.map((image, index) => (
                  <SwiperSlide key={index}>
                    <div className="flex items-center justify-center">
                      <img
                        src={image}
                        alt={`SafeSmash screen ${index + 1}`}
                        className="w-full max-w-[400px] rounded-lg object-contain"
                        style={{ imageRendering: 'auto' }}
                      />
                    </div>
                  </SwiperSlide>
                ))}
                <SwiperNavButtons />
              </Swiper>
            </div>
          </div>
        </div>

      </div>
    </>
  );
};

export default AboutPage;
