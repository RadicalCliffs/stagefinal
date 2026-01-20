import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, Pagination, Navigation } from 'swiper/modules';
import 'swiper/swiper-bundle.css';
import { btcGiveaway, rolexWatch, lamboUrus } from '../assets/images';
import { SwiperNavButtons } from './SwiperCustomNav';
import { useIsMobile } from '../hooks/useIsMobile';

interface HeroSlide {
  image: string;
  title: string;
  description: string;
  price: string;
  cta: string;
  link: string;
  slug: string;
}

const HeroCarouselV2 = () => {
  const isMobile = useIsMobile();

  const slides: HeroSlide[] = [
    {
      image: lamboUrus,
      title: 'WIN THE MOST OUTRAGEOUS URUS ON THE PLANET',
      description:
        "This is more than a competition... it's an event. A 650-horsepower Italian brute wrapped in full Prize livery, dripping in attitude, powered by fair play and fixed odds.",
      price: '$10.00',
      cta: 'Coming soon!',
      link: '/competitions/lamborghini-urus',
      slug: 'lamborghini-urus',
    },
    {
      image: btcGiveaway,
      title: 'INSTANT CRYPTO KING: WIN 1 BTC',
      description:
        "1 BTC. One draw. Unlimited envy. When this hits your wallet, your friends won't just notice, they'll wish they were you. Step into the arena and take your chance at walking away with the most iconic digital asset on the planet",
      price: '$1.00',
      cta: 'Coming soon!',
      link: '/competitions/bitcoin-giveaway',
      slug: 'bitcoin-giveaway',
    },
    {
      image: rolexWatch,
      title: 'WRIST ROYALTY AWAITS: ONE ROLEX, ONE WINNER',
      description:
        "A Rolex is the trophy everyone wants but few ever claim. Now's your chance to change that. Step into the spotlight and enter for the opportunity to wrap iconic craftsmanship, prestige, and pure status around your wrist.",
      price: '$5.00',
      cta: 'Coming soon!',
      link: '/competitions/rolex-watch',
      slug: 'rolex-watch',
    },
  ];

  return (
    <div className="bg-[#040404] max-w-7xl mx-auto rounded-xl relative z-10">
      <Swiper
        modules={[Autoplay, Pagination, Navigation]}
        spaceBetween={0}
        slidesPerView={1}
        loop={true}
        autoHeight
        autoplay={{
          delay: 7000,
          disableOnInteraction: false,
        }}
      >
        {slides.map((slide, idx) => (
          <SwiperSlide key={idx}>
            <div className="relative">
              {/* Hero Image */}
              <div className="relative w-full">
                <img
                  className="w-full rounded-t-xl sm:min-h-[571px] sm:max-h-[571px] max-h-[350px] min-h-[350px] object-cover"
                  src={slide.image}
                  alt={slide.title}
                  loading={idx === 0 ? 'eager' : 'lazy'}
                />

                {/* Mobile content below image */}
                {isMobile && (
                  <div className="bg-black p-3 pb-4">
                    <h2 className="sequel-95 text-white text-base mb-1.5 leading-tight uppercase">
                      {slide.title}
                    </h2>
                    <p className="sequel-45 text-white/90 text-[11px] mb-3 line-clamp-2 leading-snug">
                      {slide.description}
                    </p>
                    <div className="flex items-stretch gap-0 relative">
                      <div className="bg-white rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 z-10">
                        <span className="sequel-95 text-xs text-black">{slide.price}</span>
                        <span className="sequel-45 text-xs text-black/70">/ Entry</span>
                      </div>
                      <span
                        className="sequel-95 bg-[#494949] text-white/70 px-4 py-1.5 rounded-lg text-xs flex-1 text-center -ml-5 relative cursor-not-allowed"
                        style={{ boxShadow: '-8px 0 16px rgba(0, 0, 0, 0.3)' }}
                      >
                        {slide.cta}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Desktop content below image */}
              {!isMobile && (
                <div className="text-white flex md:flex-row flex-col justify-between items-center sm:py-6 py-3 xl:px-20 sm:px-10 px-4 relative rounded-bl-xl rounded-br-xl xl:gap-0 gap-4">
                  <div className="md:w-7/12 pr-8">
                    <h1 className="sequel-95 lg:text-4xl sm:text-3xl text-2xl sm:text-left text-center leading-tight mb-4">
                      {slide.title}
                    </h1>
                    <p className="sequel-45 text-sm sm:text-base sm:text-left text-center leading-relaxed">
                      {slide.description}
                    </p>
                  </div>

                  <div className="bg-white text-[#1A1A1A] rounded-xl xl:w-4/12 md:w-5/12 w-full sm:block flex items-center gap-2">
                    <p className="sequel-45 sm:px-0 pl-3 sm:text-center sm:w-auto w-full sm:text-sm text-xs py-2">
                      <span className="sequel-95">{slide.price} / </span>Entry
                    </p>

                    <span
                      className="md:sequel-95 text-center block sequel-95 bg-[#494949] text-white/70 sm:py-2 pt-2 pb-1.5 rounded-xl sm:text-base text-xs w-full cursor-not-allowed border border-white/30"
                    >
                      {slide.cta}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </SwiperSlide>
        ))}
        <div className="sm:pt-0 sm:pb-2 pt-2 pb-3">
          <SwiperNavButtons />
        </div>
      </Swiper>
    </div>
  );
};

export default HeroCarouselV2;
