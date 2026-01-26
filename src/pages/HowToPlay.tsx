import { useState } from "react";
import { Link } from "react-router";
import { ChevronDown, Trophy, CreditCard, Dice5, Zap, Shield, Gift } from "lucide-react";
import { smashGraphic, rolexWatch, lamboUrus, bitcoinImage } from "../assets/images";
import CashOutLikeAPro from "../components/CashOutLikeAPro";
import NeverMissGame from "../components/NeverMissGame";
import FaqSection from "../components/Faqs";
import Heading from "../components/Heading";
import { useIsMobile } from "../hooks/useIsMobile";

// Desktop content sections
const desktopSections = [
  {
    id: 1,
    title: "Enter a Competition",
    bullets: [
      "Entry prices are shown on each competition page.",
      "Sign up or log in, then enter using crypto, card, or your account balance.",
      "No crypto experience needed — you can create a wallet and we'll manage it for you.",
      "You can enter directly or top up your balance in advance.",
      "Free entry routes are available where legally required (see section 3.11 of our Terms).",
    ],
  },
  {
    id: 2,
    title: "Choose Your Entries",
    bullets: [
      "Browse live competitions for crypto prizes, instant wins, and luxury items.",
      "Each page shows the prize, entry price, entries sold, entry limits, and end time.",
      "Pick how you want to enter:",
    ],
    subBullets: [
      "Lucky Dip: Choose how many entries and we randomly assign numbers (fastest option).",
      "Manual Select: Choose your own available entry numbers.",
    ],
    additionalBullets: [
      "Each entry is securely recorded and linked to your account.",
      "Entry limits, if any, are clearly shown before confirmation.",
    ],
  },
  {
    id: 3,
    title: "Confirmation",
    bullets: [
      "Entries are confirmed instantly.",
      "View all live and completed entries in your account dashboard.",
    ],
  },
];

const desktopSections2 = [
  {
    id: 4,
    title: "Draws & Winner Selection",
    bullets: [
      "When a competition ends, it moves to the Drawn section.",
      "Winners are shown on the website, in your account, and may be announced on our official social channels.",
      "Entry totals update live for full transparency.",
      "All winners are selected using Chainlink VRF for provably fair, verifiable draws.",
      "The VRF transaction hash is published so results can be independently verified.",
    ],
  },
  {
    id: 5,
    title: "Prizes & Winners",
    bullets: [
      "Crypto prizes are transferred securely to your account wallet after draw approval.",
      "Physical prizes: the crypto cash alternative is transferred first, then you choose cash or the physical prize.",
      "All prize transfers include a published transaction hash for on-chain verification.",
      "Winners may be featured in our Winners section using usernames only — no wallet addresses or personal details are ever shown.",
    ],
  },
];

// Mobile accordion content
const mobileAccordionSections = [
  {
    id: 1,
    title: "Entering the Competitions",
    content: [
      "Entry prices vary by competition and are shown on each competition page.",
      "Sign up or log in, then enter using crypto, card, or account balance.",
      "No crypto experience is required — you can create a wallet and let us manage it.",
      "You can enter directly from the competition page or top up your balance in advance.",
      "Free entry routes are available where legally required (see section 3.11 of our Terms & Conditions).",
    ],
  },
  {
    id: 2,
    title: "Choosing a Competition",
    content: [
      "Browse live competitions featuring crypto prizes, instant wins, and luxury items.",
      "Each competition page shows the prize, entry price, entries sold, entry limits, and end time.",
    ],
  },
  {
    id: 3,
    title: "Selecting Your Entries",
    content: [
      "Choose how you want to enter:",
      "Lucky Dip: select the number of entries and receive randomly assigned numbers.",
      "Manual Selection: choose your own available entry numbers.",
      "Each entry represents a valid competition entry and is securely linked to your account.",
      "Entry limits may apply and are always shown before confirmation.",
    ],
  },
  {
    id: 4,
    title: "Confirmation & Account Access",
    content: [
      "Entries are confirmed instantly once completed.",
      "You can view all live and completed entries in your account dashboard, including competition and order details.",
    ],
  },
  {
    id: 5,
    title: "Winner Selection & Draws",
    content: [
      "When a competition ends, it moves into the Drawn section.",
      "Winners are displayed on the website, in your account, and may be announced on official social channels.",
      "Entry totals update live throughout the competition.",
      "All winners are selected using Chainlink VRF for a fair and verifiable draw.",
      "The VRF transaction hash is published so results can be independently verified.",
    ],
  },
  {
    id: 6,
    title: "Prize Distribution",
    content: [
      "Crypto prizes are transferred securely to your account wallet after draw approval.",
      "For physical prizes, the crypto cash alternative is transferred first.",
      "Our team will contact you to confirm whether you want the cash alternative or the physical prize.",
      "All prize transfers include a published transaction hash for on-chain verification.",
    ],
  },
  {
    id: 7,
    title: "Winner Spotlight",
    content: [
      "Winning entries may be featured in the Winners section showing username and prize details.",
      "Wallet addresses and personal details are never publicly displayed.",
    ],
  },
];

// Icon-led UI microcopy items
const iconFeatures = [
  {
    icon: Trophy,
    title: "Choose a Competition",
    description: "Live prizes with clear odds, limits, and end times.",
  },
  {
    icon: CreditCard,
    title: "Pay Your Way",
    description: "Card, crypto, or account balance. No crypto knowledge required.",
  },
  {
    icon: Dice5,
    title: "Pick Your Numbers",
    description: "Lucky Dip or manual selection — your choice.",
  },
  {
    icon: Zap,
    title: "Instant Confirmation",
    description: "Entries are confirmed immediately and stored securely.",
  },
  {
    icon: Shield,
    title: "Provably Fair Draws",
    description: "Powered by Chainlink VRF. Verifiable, transparent, on-chain.",
  },
  {
    icon: Gift,
    title: "Claim Your Prize",
    description: "Crypto paid instantly. Physical prizes or cash alternative.",
  },
];

const EnterNowCTA = ({ className = "" }: { className?: string }) => (
  <Link
    to="/competitions"
    className={`inline-block bg-[#DDE404] hover:bg-[#DDE404]/90 text-black sequel-95 uppercase sm:text-lg text-base sm:px-12 px-8 sm:py-4 py-3 rounded-xl border-2 border-white custom-box-shadow transition-all duration-200 ${className}`}
  >
    Enter Now
  </Link>
);

// Mobile Accordion Component
const MobileAccordion = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="space-y-4">
      {mobileAccordionSections.map((section, index) => {
        const isOpen = openIndex === index;
        return (
          <div
            key={section.id}
            className="rounded-xl overflow-hidden bg-[#EF008F] border border-[#EF008F]/50"
          >
            <button
              onClick={() => toggle(index)}
              className="w-full flex items-center justify-between gap-3 px-5 py-5 text-left focus:outline-none cursor-pointer"
            >
              <span className="text-white font-semibold sequel-75 text-sm leading-relaxed">
                {section.title}
              </span>
              <ChevronDown
                className={`min-w-5 max-w-5 text-white transition-transform duration-300 ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            <div
              className={`transition-all bg-[#161616] duration-300 ease-in-out ${
                isOpen
                  ? "max-h-[600px] opacity-100 px-5 py-5"
                  : "max-h-0 opacity-0 overflow-hidden"
              }`}
            >
              <ul className="space-y-4">
                {section.content.map((item, idx) => (
                  <li
                    key={idx}
                    className="text-white/90 sequel-45 text-sm leading-relaxed flex items-start gap-3"
                  >
                    <span className="text-[#DDE404] mt-1">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Desktop Section Component
const DesktopSection = ({
  section,
}: {
  section: (typeof desktopSections)[0];
}) => (
  <div className="bg-[#161616] rounded-2xl p-8 lg:p-10 border border-[#EF008F]/20 hover:border-[#EF008F]/40 transition-all duration-300">
    <h3 className="text-[#EF008F] sequel-95 text-xl lg:text-2xl mb-6 uppercase">
      {section.title}
    </h3>
    <ul className="space-y-4">
      {section.bullets.map((bullet, idx) => (
        <li
          key={idx}
          className="text-white sequel-45 text-sm lg:text-base leading-relaxed flex items-start gap-3"
        >
          <span className="text-[#DDE404] mt-1">•</span>
          <span>{bullet}</span>
        </li>
      ))}
      {"subBullets" in section && section.subBullets && (
        <ul className="ml-6 space-y-3 mt-3">
          {section.subBullets.map((subBullet, idx) => (
            <li
              key={idx}
              className="text-white/90 sequel-45 text-sm lg:text-base leading-relaxed flex items-start gap-3"
            >
              <span className="text-[#DDE404] mt-1">◦</span>
              <span>{subBullet}</span>
            </li>
          ))}
        </ul>
      )}
      {"additionalBullets" in section && section.additionalBullets && (
        <>
          {section.additionalBullets.map((bullet, idx) => (
            <li
              key={`add-${idx}`}
              className="text-white sequel-45 text-sm lg:text-base leading-relaxed flex items-start gap-3"
            >
              <span className="text-[#DDE404] mt-1">•</span>
              <span>{bullet}</span>
            </li>
          ))}
        </>
      )}
    </ul>
  </div>
);

// Icon Feature Card Component
const IconFeatureCard = ({
  feature,
}: {
  feature: (typeof iconFeatures)[0];
}) => {
  const IconComponent = feature.icon;
  return (
    <div className="bg-[#1A1A1A] rounded-xl p-6 border border-[#333] hover:border-[#EF008F]/50 transition-all duration-300 text-center">
      <div className="w-14 h-14 mx-auto mb-4 bg-[#EF008F] rounded-full flex items-center justify-center">
        <IconComponent className="w-7 h-7 text-white" />
      </div>
      <h4 className="text-white sequel-75 text-sm mb-3">{feature.title}</h4>
      <p className="text-white/70 sequel-45 text-xs leading-relaxed">
        {feature.description}
      </p>
    </div>
  );
};

const HowToPlay = () => {
  const isMobile = useIsMobile();

  return (
    <>
      <div className="max-w-7xl mx-auto">
        <div className="custom-how-to-play-background bg-full-size absolute inset-0 w-full h-full"></div>

        {/* Header Section */}
        <div className="relative xl:px-0 px-4 pt-12 sm:pt-16">
          <Heading
            text="How to Play"
            classes="text-white mb-6 max-[600px]:text-3xl lg:text-5xl"
          />
          <p className="sequel-45 text-white/80 text-center text-sm sm:text-base max-w-2xl mx-auto leading-relaxed mb-12">
            Enter competitions, win crypto and luxury prizes, all powered by
            provably fair blockchain technology.
          </p>
        </div>

        {/* Icon Features Grid - Both Mobile & Desktop */}
        <div className="relative xl:px-0 px-4 mb-14">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5">
            {iconFeatures.map((feature, index) => (
              <IconFeatureCard key={index} feature={feature} />
            ))}
          </div>
        </div>

        {/* Main Content - Desktop Version */}
        {!isMobile && (
          <div className="relative xl:px-0 px-4">
            {/* First Section Group */}
            <div className="grid md:grid-cols-3 gap-8 mb-10">
              {desktopSections.map((section) => (
                <DesktopSection key={section.id} section={section} />
              ))}
            </div>

            {/* First CTA */}
            <div className="text-center mb-14">
              <EnterNowCTA />
            </div>

            {/* Luxury Image Banner 1 - Rolex Watch */}
            <div className="relative mb-14 rounded-2xl overflow-hidden">
              <div className="relative h-48 sm:h-64 bg-gradient-to-r from-[#161616] via-[#1A1A1A] to-[#161616] border border-[#EF008F]/20">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-8">
                    <img
                      src={rolexWatch}
                      alt="Luxury Rolex Watch Prize"
                      className="h-40 sm:h-52 object-contain drop-shadow-2xl"
                    />
                    <div className="text-left hidden sm:block">
                      <p className="text-[#DDE404] sequel-95 text-2xl uppercase mb-2">Win Luxury Prizes</p>
                      <p className="text-white/70 sequel-45 text-sm max-w-xs">Premium watches, cars, and exclusive crypto rewards await lucky winners.</p>
                    </div>
                  </div>
                </div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#EF008F]/5 to-transparent pointer-events-none"></div>
              </div>
            </div>

            {/* Second Section Group */}
            <div className="grid md:grid-cols-2 gap-8 mb-10">
              {desktopSections2.map((section) => (
                <DesktopSection key={section.id} section={section} />
              ))}
            </div>

            {/* Luxury Image Banner 2 - Lamborghini */}
            <div className="relative mb-14 rounded-2xl overflow-hidden">
              <div className="relative h-56 sm:h-72 bg-gradient-to-r from-[#161616] via-[#1A1A1A] to-[#161616] border border-[#DDE404]/20">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-8">
                    <div className="text-right hidden sm:block">
                      <p className="text-[#DDE404] sequel-95 text-2xl uppercase mb-2">Dream Big</p>
                      <p className="text-white/70 sequel-45 text-sm max-w-xs">Entry into exclusive competitions for supercars and lifestyle prizes.</p>
                    </div>
                    <img
                      src={lamboUrus}
                      alt="Luxury Lamborghini Prize"
                      className="h-44 sm:h-60 object-contain drop-shadow-2xl"
                    />
                  </div>
                </div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#DDE404]/5 to-transparent pointer-events-none"></div>
              </div>
            </div>

            {/* Second CTA */}
            <div className="text-center mb-14">
              <EnterNowCTA />
            </div>

            {/* Luxury Image Banner 3 - Bitcoin/Crypto */}
            <div className="relative mb-12 rounded-2xl overflow-hidden">
              <div className="relative h-48 sm:h-56 bg-gradient-to-r from-[#161616] via-[#1A1A1A] to-[#161616] border border-[#EF008F]/20">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-8">
                    <img
                      src={bitcoinImage}
                      alt="Bitcoin Crypto Prizes"
                      className="h-32 sm:h-40 object-contain drop-shadow-2xl"
                    />
                    <div className="text-left hidden sm:block">
                      <p className="text-[#EF008F] sequel-95 text-2xl uppercase mb-2">Crypto Prizes</p>
                      <p className="text-white/70 sequel-45 text-sm max-w-xs">Win Bitcoin, Ethereum, and other top cryptocurrencies in our draws.</p>
                    </div>
                  </div>
                </div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#EF008F]/5 to-transparent pointer-events-none"></div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content - Mobile Version (Accordion) */}
        {isMobile && (
          <div className="relative px-4 mb-10">
            <MobileAccordion />

            {/* Luxury Image - Mobile (Rolex) */}
            <div className="mt-10 mb-8 rounded-xl overflow-hidden">
              <div className="relative h-44 bg-gradient-to-r from-[#161616] to-[#1A1A1A] border border-[#EF008F]/20">
                <div className="absolute inset-0 flex items-center justify-center">
                  <img
                    src={rolexWatch}
                    alt="Luxury Rolex Watch Prize"
                    className="h-36 object-contain drop-shadow-xl"
                  />
                </div>
              </div>
              <p className="text-center text-[#DDE404] sequel-75 text-sm uppercase mt-3">Win Luxury Prizes</p>
            </div>

            {/* Sticky CTA for Mobile */}
            <div className="mt-8 text-center">
              <EnterNowCTA className="w-full" />
            </div>

            {/* Luxury Image - Mobile (Lambo) */}
            <div className="mt-10 mb-8 rounded-xl overflow-hidden">
              <div className="relative h-44 bg-gradient-to-r from-[#161616] to-[#1A1A1A] border border-[#DDE404]/20">
                <div className="absolute inset-0 flex items-center justify-center">
                  <img
                    src={lamboUrus}
                    alt="Luxury Lamborghini Prize"
                    className="h-36 object-contain drop-shadow-xl"
                  />
                </div>
              </div>
              <p className="text-center text-[#DDE404] sequel-75 text-sm uppercase mt-3">Dream Big</p>
            </div>

            {/* Luxury Image - Mobile (Bitcoin) */}
            <div className="mt-6 mb-8 rounded-xl overflow-hidden">
              <div className="relative h-36 bg-gradient-to-r from-[#161616] to-[#1A1A1A] border border-[#EF008F]/20">
                <div className="absolute inset-0 flex items-center justify-center">
                  <img
                    src={bitcoinImage}
                    alt="Bitcoin Crypto Prizes"
                    className="h-28 object-contain drop-shadow-xl"
                  />
                </div>
              </div>
              <p className="text-center text-[#EF008F] sequel-75 text-sm uppercase mt-3">Crypto Prizes</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Sections */}
      <div className="relative overflow-hidden">
        <img
          src={smashGraphic}
          alt="smashGraphic"
          className="absolute -left-[4%] top-[10%] w-12/12 mx-auto xl:block hidden"
        />
        <div className="relative">
          <div className="sm:mt-14 mt-12 mb-16 xl:px-0 px-4">
            <CashOutLikeAPro />
          </div>
          <div className="lg:px-0 px-4">
            <NeverMissGame />
          </div>
          <div className="mt-12 sm:mb-16 mb-8 xl:px-0 px-4">
            <FaqSection />
          </div>
        </div>
      </div>
    </>
  );
};

export default HowToPlay;
