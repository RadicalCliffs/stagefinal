import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import Heading from '../components/Heading';

interface FaqItem {
  question: string;
  answer: string;
}

const FaqPage = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const toggle = (index: number | null) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const faqs: FaqItem[] = [
    {
      question: "What is ThePrize.io?",
      answer: "ThePrize.io is a crypto-based competition platform where you can win exciting digital prizes and luxury items by entering various competitions using both cryptocurrency and fiat. However, the fiat option will only be available in approved jurisdictions."
    },
    {
      question: "How do I enter a competition?",
      answer: "For single prize comps you can select your own ticket numbers or use our lucky dip function. For instant wins see the next FAQ below. First, ensure you have opened an account on our website. Select how much you wish to top your account up to, to purchase tickets. Then choose the competition you wish to enter. You can also enter a competition directly by pressing ENTER NOW on the comp page. When you have paid your entry fee, you will be told if you have answered the multiple choice question correctly. If you have, you will be entered in the draw with all the other correct entries. If you fail to answer correctly, you will not be entered into the draw. Anyone entering for free will not be told whether they have answered the question correctly and will not receive confirmation that they are entered into the draw. However, all entered ticket numbers are published on the competition pages and therefore all entrants should check this to ensure they have been entered into the draw for the competition they have entered."
    },
    {
      question: "How do instant wins work?",
      answer: "Unlike a single prize comp, instant wins prizes have a ticket number already attached to the prize. These are displayed on the comp page. When you use our lucky dip function and pay for your tickets, you will be notified instantly if you have won and if successful you can claim your prize. Our added bonus is that every ticket purchased -whether it's a win or lose- will be entered into the end prize draw! Prizes will vary across different competitions."
    },
    {
      question: "Does ThePrize.io have a gambling licence?",
      answer: "No, due to the way the platform is structured, we are free from gambling regulations by law in Europe and many other jurisdictions. Please see our Terms & Conditions, Acceptable Use Policy, Privacy Policy and Terms of Use."
    },
    {
      question: "What cryptocurrencies are accepted?",
      answer: "We accept a range of popular cryptocurrencies on networks, including Ethereum (ETH), Base (BASE) and Solana (SOL) with more being added soon."
    },
    {
      question: "How are winners selected?",
      answer: "Our winners are chosen using Chainlink VRF random number generator, ensuring a fair and transparent process verifiable on-chain. You will be able to view the tx hash of the draw on our site, and will be notified if you have won for verification. This ensures fairness and transparency in winner selection."
    },
    {
      question: "What is VRF in blockchain?",
      answer: "A verifiable random function (VRF) is a cryptographic function that takes a series of inputs, computes them, and produces a pseudorandom output and proof of authenticity that can be verified on-chain by anyone. At ThePrize.io we automatically generate our winners using Chainlink VRF and attach the proof of fair draw to the finished competition details to be verified."
    },
    {
      question: "When do you announce the winners?",
      answer: "Winners are announced in the drawn section of our website immediately after the comp has ended. We may also post winners in the Telegram Announcements group and across our socials once the comp timer runs out or when all tickets are sold, you will also be notified in the MY ACCOUNT - ENTRIES section if you have won."
    },
    {
      question: "What happens if I win?",
      answer: "If you win and you have the correct chain wallet address saved in your account section, your crypto prize will be transferred directly to your digital wallet. If you have won a luxury item, we will contact you to arrange delivery or a crypto cash alternative. In any case our team would contact you via email or Telegram. We may also feature your wallet address and profile avatar on our winners page!"
    },
    {
      question: "Is there a limit to the number of tickets I can buy?",
      answer: "The number of tickets you can purchase per competition may vary. Please check the specific competition's details for any limitations."
    },
    {
      question: "Can I get a refund if I change my mind?",
      answer: "All ticket purchases are final. Once you've entered a competition, refunds are not available, so please ensure you're confident before buying your tickets."
    },
    {
      question: "How do I contact customer support?",
      answer: "For any inquiries or issues, you can reach our customer support team through our Telegram tech support bot, or by emailing us directly at contact@theprize.io."
    },
    {
      question: "How do I stay updated on new competitions?",
      answer: "To stay updated on our latest competitions and announcements, follow us on social media on Telegram, X and Instagram."
    }
  ];

  return (
    <div className="min-h-screen bg-[#1A1A1A]">
      <div className="custom-individual-competition-page-background bg-full-size absolute inset-0 w-full h-full"></div>

      <div className="relative py-16 xl:px-0 sm:px-6 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Heading
              text="Frequently Asked Questions"
              classes="text-white mb-6 max-[600px]:text-3xl lg:text-5xl"
            />
            <p className="sequel-45 text-white/70 text-base sm:text-lg max-w-3xl mx-auto leading-relaxed">
              Find answers to the most common questions about ThePrize.io competitions, entries, and prizes.
            </p>
          </div>

          <div className="space-y-4 mb-16">
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index;
              return (
                <div
                  key={index}
                  className="sm:rounded-2xl rounded-xl overflow-hidden bg-[#DDE404] border-2 border-[#DDE404]/20 hover:border-[#DDE404] transition-all duration-300"
                >
                  <button
                    onClick={() => toggle(index)}
                    className="w-full flex items-center gap-3 sm:px-6 px-4 sm:py-5 py-4 text-left focus:outline-none cursor-pointer"
                  >
                    <ChevronDown
                      className={`min-w-6 max-w-6 transition-transform duration-300 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                    <span className="text-[#1A1A1A] font-semibold sequel-75 sm:text-lg text-base leading-relaxed">
                      {faq.question}
                    </span>
                  </button>

                  <div
                    className={`transition-all bg-[#171717] duration-300 ease-in-out ${
                      isOpen
                        ? "max-h-[500px] opacity-100 sm:px-6 px-4 sm:py-5 py-4"
                        : "max-h-0 opacity-0 overflow-hidden"
                    }`}
                  >
                    <p className="text-white/90 sequel-45 leading-loose sm:text-base text-sm">
                      {faq.answer}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-center py-8">
            <p className="sequel-45 text-white/70 text-base sm:text-lg mb-6">
              Still have questions?
            </p>
            <a
              href="mailto:contact@theprize.io"
              className="inline-block bg-[#DDE404] text-black sequel-95 uppercase px-8 sm:px-12 py-3 sm:py-4 rounded-xl text-base sm:text-lg hover:bg-[#c7cc04] transition-all duration-200 custom-box-shadow border-2 border-white"
            >
              Contact Support
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FaqPage;
