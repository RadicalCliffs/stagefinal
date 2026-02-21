import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay, Pagination, Navigation } from 'swiper/modules'
import 'swiper/swiper-bundle.css'
import { Link } from 'react-router'
import { heroSectionImage, priceTag } from '../assets/images'
import bitcoinImage from '../assets/images/bitcoin-image.webp'
import watchImage from '../assets/images/watch-image.webp'
import sportsCarImage from '../assets/images/sports-car.webp'
import { useIsMobile } from '../hooks/useIsMobile'
import { useEffect, useState } from 'react'
import { database } from '../lib/database'
import { supabase } from '../lib/supabase'
import { SwiperNavButtons } from './SwiperCustomNav'

const HeroCarousel = () => {
  const isMobile = useIsMobile()
  const [heroCompetitions, setHeroCompetitions] = useState<any[]>([])
  const [sliderInterval, setSliderInterval] = useState(5000)

  useEffect(() => {
    const fetchHeroCompetitions = async () => {
      const data = await database.getHeroCompetitions()
      if (data && data.length > 0) {
        setHeroCompetitions(data)
      }
    }

    const fetchSliderSettings = async () => {
      const { data } = await supabase
        .from('site_metadata')
        .select('value')
        .eq('category', 'hero_carousel')
        .eq('key', 'slider_interval')
        .maybeSingle() as any

      if (data?.value) {
        setSliderInterval(parseInt(data.value) || 5000)
      }
    }

    fetchHeroCompetitions()
    fetchSliderSettings()
  }, [])

  const defaultSlides = [
    {
      image: heroSectionImage,
      title: 'WIN 10 BITCOIN',
      description:
        "Ape into this $50,000 competition for just $1 and stand a 39/1 chance to win one of 2800 prizes. Even if you don't bag.",
      price: '$24.99',
      cta: 'ENTER NOW',
      link: '/competitions',
    },
    {
      image: watchImage,
      title: 'WIN A LUXURY WATCH',
      description: 'Enter this premium $20 competition for a chance to own an exclusive luxury timepiece.',
      price: '$19.99',
      cta: 'ENTER NOW',
      link: '/competitions',
    },
    {
      image: sportsCarImage,
      title: 'WIN A SPORTS CAR',
      description: 'Jump into this high-stakes $30 competition and stand a real chance to win a dream sports car. ',
      price: '$29.99',
      cta: 'ENTER NOW',
      link: '/competitions',
    },
  ]

  const slides =
    heroCompetitions.length > 0
      ? heroCompetitions.map(hero => ({
          image: hero.background_image || bitcoinImage,
          title: hero.title || 'WIN NOW',
          description: hero.description || '',
          price: hero.entry_price_display || '$0.99',
          cta: hero.cta_text || 'ENTER NOW',
          link: hero.competition_id
            ? `/competitions/${hero.competition_id}`
            : '/competitions',
        }))
      : defaultSlides

  return (
    <div className="bg-[#040404] max-w-7xl mx-auto rounded-xl relative z-10">
      <Swiper
        modules={[Autoplay, Pagination, Navigation]}
        spaceBetween={0}
        slidesPerView={1}
        loop={true}
        autoHeight
        // autoplay={{
        //   delay: sliderInterval,
        //   disableOnInteraction: false,
        // }}
        // pagination={{
        //   clickable: true,
        //   bulletClass: 'swiper-pagination-bullet !bg-white/50',
        //   bulletActiveClass: 'swiper-pagination-bullet-active !bg-[#DDE404]',
        // }}
        // className="hero-carousel"
      >
        {slides.map((slide, idx) => (
          <SwiperSlide key={idx}>
            <div>
              <img
                className="w-full rounded-t-xl sm:min-h-[571px] sm:max-h-[571px] max-h-[350px] min-h-[350px] object-cover"
                src={slide.image}
                alt={slide.title}
                loading={idx === 0 ? 'eager' : 'lazy'}
              />

              <div className=" text-white flex md:flex-row flex-col justify-between items-center sm:py-10 py-4 xl:px-20 sm:px-10 px-4 relative rounded-bl-xl rounded-br-xl xl:gap-0 gap-6">
                <div className="md:w-6/12">
                  <h1 className="sequel-95 lg:text-4xl sm:text-3xl text-2xl sm:text-left text-center">
                    {slide.title}
                  </h1>
                  <p className="sequel-45 text-sm sm:mt-4 mt-1 sm:text-left text-center">
                    {slide.description}
                  </p>
                </div>

                <div className="bg-white text-[#1A1A1A] rounded-xl xl:w-3/12 md:w-6/12 w-full sm:block flex items-center gap-3">
                  <p className="sequel-45 sm:px-0 pl-4 sm:text-center sm:w-auto w-full sm:text-base text-xs">
                    <img src={priceTag} alt="price-tag" className="sm:inline hidden" />
                    <span className="sequel-95">{slide.price} / </span>Entry
                  </p>

                  <Link
                    to={slide.link}
                    className="md:sequel-95 text-center block sequel-95 bg-[#DDE404] sm:py-3 pt-3 pb-2.5 rounded-xl sm:text-lg text-xs w-full cursor-pointer border border-white hover:bg-[#c7cc04] custom-box-shadow"
                  >
                    {slide.cta}
                  </Link>
                </div>
              </div>
            </div>
          </SwiperSlide>
        ))}
        <div className='sm:pt-0 sm:pb-4 pt-4 pb-6'>
          <SwiperNavButtons />
        </div>
      </Swiper>
    </div>
  )
}

export default HeroCarousel
