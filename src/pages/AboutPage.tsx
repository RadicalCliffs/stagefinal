import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, A11y } from 'swiper/modules';
import 'swiper/swiper-bundle.css';
import { SwiperNavButtons } from '../components/SwiperCustomNav';
import { aboutMobile41, aboutMobile42, aboutMobile43 } from '../assets/images';

const SUPABASE_STORAGE_URL = 'https://cyxjzycxnfqctxocolwr.supabase.co/storage/v1/object/public/Web%20Assets/All%20Website%20Images';

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
    aboutMobile41,
    aboutMobile42,
    aboutMobile43,
  ];

  return (
    <>
      <div className="custom-landing-page-background bg-full-size absolute inset-0 w-full h-full"></div>
      <div className="relative">

        <div className="hidden md:block">
          <div className="max-w-5xl mx-auto space-y-[4.6rem] px-4">
            {desktopFrames.map((frame, index) => (
              <div key={index} className="w-full py-[2.3rem] flex justify-center">
                <img
                  src={frame}
                  alt={`About section ${index + 1}`}
                  className="w-full max-w-4xl h-auto object-contain"
                  loading={index === 0 ? "eager" : "lazy"}
                  style={{ imageRendering: 'auto' }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="md:hidden">
          <div className="flex flex-col items-center">
            {/* Part 1: Hero section with gold coins - extends to screen edges */}
            <div className="w-full py-[0.53rem] flex justify-center">
              <img
                src={mobileFrames[0]}
                alt="About section 1"
                className="w-full h-auto object-contain"
                loading="eager"
                style={{ imageRendering: 'auto' }}
              />
            </div>

            {/* Part 2: Middle section - 69% reduced spacing */}
            <div className="w-full py-[0.53rem] flex justify-center px-4">
              <img
                src={mobileFrames[1]}
                alt="About section 2"
                className="w-full max-w-[320px] h-auto object-contain"
                loading="lazy"
                style={{ imageRendering: 'auto' }}
              />
            </div>

            {/* Part 3: Black explainer box - extends to screen edges */}
            <div className="w-full py-[0.53rem] flex justify-center">
              <img
                src={mobileFrames[2]}
                alt="About section 3"
                className="w-full h-auto object-contain"
                loading="lazy"
                style={{ imageRendering: 'auto' }}
              />
            </div>

            {/* Part 4: Carousel - joined to part 3 with reduced spacing to carousel */}
            <div className="w-full py-[1.14rem] bg-linear-to-br from-pink-600 via-purple-700 to-[#1A1A1A] overflow-hidden">
              <Swiper
                modules={[Navigation, Pagination, A11y]}
                spaceBetween={20}
                slidesPerView={1}
                loop
                className="px-4 overflow-hidden"
              >
                {mobileCarousel.map((image, index) => (
                  <SwiperSlide key={index}>
                    <div className="flex items-center justify-center pb-12">
                      <img
                        src={image}
                        alt={`SafeSmash screen ${index + 1}`}
                        className="w-full max-w-70 rounded-lg object-contain"
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
