import { useEffect } from 'react';
import { ambCrypto, bitNews, cryptoNews, feast,  financialNews, uToday } from '../assets/images';

const FeaturedInLogos = () => {

  useEffect(() => {
    const scrollers = document.querySelectorAll(".scroller");

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      addAnimation();
    }

    function addAnimation() {
      scrollers.forEach((scroller) => {
        scroller.setAttribute("data-animated", 'true');

        const scrollerInner = scroller.querySelector(".scroller__inner") as HTMLDivElement;
        const scrollerContent = Array.from(scrollerInner.children);

        scrollerContent.forEach((item) => {
          const duplicatedItem = item.cloneNode(true) as HTMLDivElement;
          duplicatedItem.setAttribute("aria-hidden", 'true');
          scrollerInner.appendChild(duplicatedItem);
        });
      });
    }

  }, [])

  return (
    <div className='relative pt-8 sm:pb-14 pb-10 overflow-hidden'>
      <div className='flex justify-center w-full px-8'>
        <h2 className='text-white sequel-95 uppercase text-2xl md:text-4xl sm:mb-10 mb-8'>Featured In</h2>
      </div>

      <div className="scroller mx-auto" data-direction="right" data-speed="fast">
        <div className="scroller__inner flex items-center gap-20">
          <img className="sm:w-64 w-48" src={bitNews} alt="" />
          <img className="sm:w-64 w-48" src={cryptoNews} alt="" />
          <img className="sm:w-48 w-28" src={feast} alt="" />
          <img className="sm:w-88 w-72" src={financialNews} alt="" />
          <img className="sm:w-64 w-48" src={uToday} alt="" />
          <img className="sm:w-64 w-48" src={ambCrypto} alt="" />
        </div>
      </div>
    </div>
  )
}

export default FeaturedInLogos
