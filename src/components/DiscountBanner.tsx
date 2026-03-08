import { useRealTimeBalance } from "../hooks/useRealTimeBalance";

interface BannerContent {
  highlight_text: string;
  main_text: string;
  link?: string | null;
  background_color?: string;
}

// Default banner content for pre-topup users
const PRE_TOPUP_BANNER: BannerContent = {
  highlight_text: "50% bonus credits",
  main_text: "on your first wallet top-up!",
  background_color: "#EF008F",
};

// Default banner content for post-topup users (can be changed via admin)
const POST_TOPUP_BANNER: BannerContent = {
  highlight_text: "SUBMIT OUR FEEDBACK FORM",
  main_text: "FOR $20 SITE CREDIT",
  link: "https://forms.gle/WvDabrEKk7ejUa188",
  background_color: "#EF008F",
};

const DiscountBanner = () => {
  // Check if user has already used their first top-up bonus
  const { hasUsedBonus } = useRealTimeBalance();

  // Select banner based on whether user has topped up
  const banner = hasUsedBonus ? POST_TOPUP_BANNER : PRE_TOPUP_BANNER;

  const content = (
    <p className="uppercase sequel-45 sm:text-sm text-xs max-[410px]:text-[0.65rem] text-white">
      <span className="sequel-75">{banner.highlight_text} </span>
      {banner.main_text}
    </p>
  );

  return (
    <div
      className="w-full text-center py-4"
      style={{ backgroundColor: banner.background_color || "#EF008F" }}
    >
      {banner.link ? (
        <a
          href={banner.link}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-90 transition-opacity"
        >
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  );
};

export default DiscountBanner;
