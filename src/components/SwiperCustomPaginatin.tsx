import { useEffect, useState } from "react";
import { useSwiper } from "swiper/react";

export const SwiperBarPagination = () => {
    const swiper = useSwiper();
    const [activeIndex, setActiveIndex] = useState(0);
    const [realSlidesCount, setRealSlidesCount] = useState(0);

    useEffect(() => {
        if (!swiper || !swiper.slidesEl) return;

        const updatePagination = () => {
            // ✅ Count only non-duplicate slides
            const realSlides = swiper.slidesEl.querySelectorAll(
                ".swiper-slide:not(.swiper-slide-duplicate)"
            );
            setRealSlidesCount(realSlides.length);
            setActiveIndex(swiper.realIndex);
        };

        // Run once after initialization
        updatePagination();

        // Keep in sync with Swiper events
        swiper.on("slideChange", () => setActiveIndex(swiper.realIndex));
        swiper.on("loopFix", updatePagination);
        swiper.on("slidesLengthChange", updatePagination);

        return () => {
            swiper.off("slideChange");
            swiper.off("loopFix");
            swiper.off("slidesLengthChange");
        };
    }, [swiper]);

    if (realSlidesCount === 0) return null;

    return (
        <div
            className="flex justify-center gap-2"
            id="landing-page-fair-draws"
        >
            {Array.from({ length: realSlidesCount }, (_, i) => (
                <button
                    key={i}
                    onClick={() => swiper.slideToLoop(i)} // ✅ Works with loop mode
                    className={`w-[60px] h-[6px] cursor-pointer rounded-[5px] transition-all duration-300 ${i === activeIndex
                            ? "bg-[#DDE404] opacity-100"
                            : "bg-white opacity-[0.15]"
                        }`}
                />
            ))}
        </div>
    );
};
