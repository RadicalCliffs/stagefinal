import {
  crown,
  individualFairDrawBg,
  rocket,
  ticket,
} from "../assets/images";
import type {
  Faq,
  Step,
  WinnerCardProps,
} from "../models/models";

// Static content for "How it works" section
export const steps: Step[] = [
  {
    icon: ticket,
    title: "How To Enter\nThe Prize\nCompetitions",
    description:
      "Browse our awesome selection of competitions, click on buy entries. Use the Lucky Dip or custom entry selector to select the entry number of your choice to enter the competition.",
    bgImage: individualFairDrawBg,
  },
  {
    icon: crown,
    title: "How The\nWinner Is Picked\n& When We Go Live",
    description:
      "The winner is selected using Google random number generator on our live Facebook feed, this will take place when the timer runs out or when the competition sells out.",
    bgImage: individualFairDrawBg,
  },
  {
    icon: rocket,
    title: "Delivery &\nWinner\nPictures",
    description:
      "Join our ever growing WINNERS list and go into the Bounty hall of fame with your winners picture, make your dreams a reality! You have to be in it to win it!",
    bgImage: individualFairDrawBg,
  },
];

// Static explanatory content for competition process - DESKTOP VERSION
export const enteringCompetitionProcess = [
  {
    id: 1,
    text: "Buying Entries: Entry prices vary by competition and are clearly displayed on each competition page. To enter a competition, simply sign up or log in and enter using crypto or card, or your available account balance. You can create a wallet and let us manage it for you, so no crypto experience is required.",
  },
  {
    id: 2,
    text: "You can enter directly from the competition page or top up your balance in advance. Free entry routes are available where legally required; see section 3.11 of our Terms & Conditions for details.",
  },
  {
    id: 3,
    text: "Choose Your Competition: Browse our live competitions featuring crypto prizes, instant wins, and luxury items. Each competition page shows the entry price, prize details, entries sold, any entry limits, and the competition end time.",
  },
  {
    id: 4,
    text: "Select Your Entries: Entering is quick and flexible, you choose how you want to play. Use the lucky dip entry slider to select how many entries you want and let the system randomly assign your entry numbers for you. This is the fastest way to enter and ideal for first-time users. Prefer more control? You can manually select your own entry numbers from the available numbers for that competition before confirming your entry.",
  },
  {
    id: 5,
    text: "Each entry represents a valid competition entry and is securely recorded and linked to your account. Entry limits may apply depending on the competition and will always be clearly displayed before you confirm.",
  },
  {
    id: 6,
    text: "Confirmation: Once your entry is completed, it's confirmed instantly. You can view all live and finished entries in your account dashboard, including competition and order details.",
  },
];

export const winnerSelectionProcess = [
  {
    id: 1,
    text: "Announcement: When a competition ends, the draw is completed and the competition moves into the Drawn section. Winners are shown on the website and inside your account dashboard, and may also be announced via our official social channels.",
  },
  {
    id: 2,
    text: "Draw Transparency: Entry totals update live on the competition page, ensuring full transparency throughout the competition.",
  },
  {
    id: 3,
    text: "End Draw: All winners are selected using Chainlink VRF, providing a fair and verifiable random draw. The VRF transaction hash is published so results can be independently verified, alongside full winner and prize details.",
  },
];

export const prizeDistributionProcess = [
  {
    id: 1,
    text: "Prize Distribution: If you win a crypto prize, it will be transferred securely to your account wallet once the draw has been completed and approved. For physical prizes, the crypto cash alternative will be transferred first. Our team will then contact you to confirm whether you would like to keep the cash alternative or swap it for the physical prize. All crypto prize transfers include a transaction hash, which is published on-site for full on-chain verification."
  },
  {
    id: 2,
    text: "Winner Spotlight: Winning entries may be featured in our Winners section, displaying the winner's username and prize details. Wallet addresses and personal details are never publicly exposed, ensuring winners remain anonymous while results stay transparent."
  },
];

// Mobile accordion version - How to Play content
export const mobileHowToPlayAccordion = [
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

export const faqs: Faq[] = [
  {
    question: "What is ThePrize.io?",
    answer:
      "ThePrize.io is a blockchain-powered competition platform where users can buy entries using cryptocurrency to enter fair and transparent prize draws. All competitions are verifiably random using blockchain technology.",
  },
  {
    question: "How do I enter a competition?",
    answer:
      "To enter a competition, simply select the competition you're interested in, choose the number of entries you'd like to purchase, and complete your payment using one of the accepted cryptocurrencies.",
  },
  {
    question: "How do instant wins work?",
    answer:
      "Instant wins are special competitions where your entry purchase is immediately checked against winning combinations. If your entry matches a winning condition, you win instantly—no waiting for a draw!",
  },
  {
    question: "Does ThePrize.io have a gambling licence?",
    answer:
      "ThePrize.io operates as a skill and luck-based prize competition platform, not as a gambling site. However, we comply with all relevant legal and regulatory standards in the jurisdictions we operate in.",
  },
  {
    question: "What cryptocurrencies are accepted?",
    answer:
      "We currently accept popular cryptocurrencies such as Bitcoin (BTC), Ethereum (ETH), Solana (SOL), and USDT (Tether). More options will be added over time to make participation even easier.",
  },
  {
    question: "How are winners selected?",
    answer:
      "Winners are selected using blockchain-verified randomization (VRF), ensuring that every draw is fair, transparent, and tamper-proof. Results are published on-chain for full transparency.",
  },
  {
    question: "What is VRF in blockchain?",
    answer:
      "VRF stands for Verifiable Random Function. It's a cryptographic method that generates provably fair and random outcomes. This ensures that the results of each competition are 100% unbiased and transparent.",
  },
  {
    question: "When do you announce the winners?",
    answer:
      "Winners are announced immediately after each draw concludes. For instant win competitions, results are revealed instantly after entry purchase. Notifications are also sent to the registered email address.",
  },
  {
    question: "What happens if I win?",
    answer:
      "If you win, you'll receive an instant on-screen notification and an email confirmation. Depending on the prize type, digital prizes are sent directly to your wallet, and physical prizes are shipped to your verified address.",
  },
  {
    question: "Is there a limit to the number of tickets I can buy?",
    answer:
      "Yes, each competition has its own entry purchase limit to ensure fairness. You can view the maximum number of entries allowed on the competition's detail page.",
  },
  {
    question: "Can I get a refund if I change my mind?",
    answer:
      "Once an entry has been purchased, it cannot be refunded since your entry is immediately logged on the blockchain. Please double-check your selection before completing your transaction.",
  },
  {
    question: "How do I contact customer support?",
    answer:
      "You can contact our support team anytime through the Contact page or by emailing support@theprize.io. Our team typically responds within 24 hours.",
  },
  {
    question: "How do I stay updated on new competitions?",
    answer:
      "Follow us on social media, join our Telegram or Discord community, or subscribe to our newsletter for the latest updates on new competitions, winners, and exclusive promotions.",
  },
];

// Placeholder winners for display until live data is populated
export const winners: WinnerCardProps[] = [
  {
    prize: "5 Bitcoin",
    username: "XXXX-XXXXX-XXXX",
    country: "United Kingdom",
    wallet: "0x123...daw2",
    date: "12.12.2025",
    showInstantWin: true,
  },
  {
    prize: "1 Ethereum",
    username: "USER-XXXX-8888",
    country: "Canada",
    wallet: "0x82a...ee4a",
    date: "11.11.2025",
    showInstantWin: false,
  },
  {
    prize: "50K Insta Win",
    username: "TRVL-1234-XXX",
    country: "UAE",
    wallet: "0x91b...f9e1",
    date: "10.10.2025",
    showInstantWin: true,
  },
  {
    prize: "10K Insta Win",
    username: "WIN-9876-ABCD",
    country: "United States",
    wallet: "0xabc...123f",
    date: "09.10.2025",
    showInstantWin: true,
  },
  {
    prize: "5 Ethereum",
    username: "CRYPTO-5555-XYZ",
    country: "Germany",
    wallet: "0xdef...456g",
    date: "08.10.2025",
    showInstantWin: false,
  },
  {
    prize: "1 Bitcoin",
    username: "BTC-WINNER-2024",
    country: "Australia",
    wallet: "0x789...hij0",
    date: "07.10.2025",
    showInstantWin: false,
  },
];
