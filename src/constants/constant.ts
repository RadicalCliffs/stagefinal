import {
  crown,
  individualFairDrawBg,
  monkeyNftV3,
  rocket,
  ticket,
} from "../assets/images";
import type {
  EntryCard,
  Faq,
  Step,
  WinnerCardProps,
} from "../models/models";

// Placeholder entries for user dashboard display until live data is populated
export const MOCK_ENTRIES: EntryCard[] = [
  {
    id: 1,
    title: "BAYC NFT",
    description:
      "Rev up your excitement! Enter our car raffle for a chance to win the sleek and",
    image: monkeyNftV3,
    status: "win",
  },
  {
    id: 2,
    title: "Tesla Model Y",
    description:
      "Join the draw for a chance to win the brand new Tesla Model Y — fully electric and sleek.",
    image: monkeyNftV3,
    status: "loss",
  },
  {
    id: 3,
    title: "MacBook Pro 16 inch",
    description:
      "Upgrade your setup! Participate to win a MacBook Pro with M3 Max performance.",
    image: monkeyNftV3,
    status: "win",
  },
  {
    id: 4,
    title: "Dubai Luxury Trip",
    description:
      "A 7-day all-inclusive trip to Dubai for two — win your dream vacation!",
    image: monkeyNftV3,
    status: "loss",
  },
  {
    id: 5,
    title: "PlayStation 5 Bundle",
    description:
      "Join to win a PlayStation 5 bundle with extra controllers and top games.",
    image: monkeyNftV3,
    status: "win",
  },
  {
    id: 6,
    title: "iPhone 15 Pro",
    description:
      "Win Apple's latest iPhone 15 Pro with cutting-edge titanium finish.",
    image: monkeyNftV3,
    status: "loss",
  },
];

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

// Static explanatory content for competition process
export const enteringCompetitionProcess = [
  {
    id: 1,
    text: "All entries cost $0.99 and you get discounts when purchasing in bundles. You must first connect your wallet, you can then enter direct on the competition page for $0.99 per entry or visit the TOP UP BALANCE section in your account to add funds.",
  },
  {
    id: 2,
    text: "Choose Your Competition: Explore our range of exciting crypto and luxury item competitions and select the one that interests you. Please note that competitions may have different entry prices and may require multiple entries. All information including entry requirements and prize information will be displayed on the competition page. To enter for free, see section 3.11 of our Terms & Conditions.",
  },
  {
    id: 3,
    text: "Pick Your Entry Numbers: Use our Lucky Dip feature to have your numbers randomly assigned or choose your own numbers with our selective number picker. You can purchase as many entries as you like, depending on the competition's rules.",
  },
  {
    id: 4,
    text: "Confirmation: After completing your purchase, you will be able to view these inside the MY ACCOUNT section where you will find the details of your entry numbers and competition entry. This ensures you have a record of your participation.",
  },
];

export const winnerSelectionProcess = [
  {
    id: 1,
    text: "Announcement: Once all entries are sold for a competition or the timer has ended, we'll announce the winner of the competition via our social media channels. You will also see if you have won or lost inside the MY ACCOUNT section.",
  },
  {
    id: 2,
    text: "Draw Numbers: All entry numbers and buyer wallet addresses will be added to the competition page as they are purchased for full transparency.",
  },
  {
    id: 3,
    text: "End Draw: At the end of each competition we'll use Chainlink VRF random number generator to fairly and transparently select the winning entry, we will then publish the winning Chainlink VRF transaction hash for users to independently verify. We will also publish the corresponding winners on our website and inside the MY ACCOUNT section along with the transaction hash transfer of the crypto prize to the winning wallet address.",
  },
];

export const prizeDistributionProcess = [
  { 
    id: 1, 
    text: "Prize Distribution: Once you've been announced as the winner, your prize will be securely transferred in cryptocurrency to your digital wallet within 7 days, however in most cases this will be done within 24 hours. If you've won a physical prize our team will contact you directly via telegram or email to arrange delivery, or offer you a crypto cash alternative. The transaction hash of any crypto prize transfer will be published on our website and inside the MY ACCOUNT section for on-chain verification." 
  },
  { 
    id: 2, 
    text: "Winner Spotlight: Your achievement may be highlighted in our Winners section on the website, where your username and winning wallet address would be proudly displayed for the community to see, however your identity will remain anonymous." 
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
