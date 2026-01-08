import { useState, useEffect } from "react";
import { Link } from "react-router";
import Heading from "./Heading";
import { ChevronDown } from "lucide-react";
import { database } from "../lib/database";
import type { Faq } from "../models/models";

export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [faqs, setFaqs] = useState<Faq[]>([]);

  useEffect(() => {
    const fetchFaqs = async () => {
      const data = await database.getFaqs();
      setFaqs(data);
    };
    fetchFaqs();
  }, []);

  const toggle = (index: number | null) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const visibleFaqs = faqs.slice(0, 4);

  return (
    <section>
      <div className="max-w-5xl mx-auto">
        <Heading
          text="Faqs"
          classes="text-white sm:mb-13 mb-6 max-[600px]:text-2xl lg:text-4xl"
        />

        <div className="space-y-4">
          {visibleFaqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className="sm:rounded-2xl rounded-md overflow-hidden bg-[#DDE404]"
              >
                <button
                  onClick={() => toggle(index)}
                  className="w-full flex items-center gap-2 px-5 sm:pt-2.5 sm:pb-3 pt-2 pb-1.5 text-left focus:outline-none cursor-pointer"
                >
                  <ChevronDown
                    className={`min-w-5 max-w-5 sm:mt-1.5 -mt-0.5 transition-transform duration-300 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-[#1A1A1A] font-semibold sequel-45 sm:text-base text-xs leading-loose">
                    {faq.question}
                  </span>
                </button>

                <div
                  className={`transition-all bg-[#171717] duration-300 ease-in-out ${
                    isOpen
                      ? "max-h-40 opacity-100 p-5 pt-0"
                      : "max-h-0 opacity-0 overflow-hidden"
                  }`}
                >
                  <p className="text-white sequel-45 pt-2.5 leading-loose sm:text-base text-xs">
                    {faq.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* See All FAQs button */}
        <div className="text-center mt-9 mb-16">
          <Link
            to="/faq"
            className="inline-block bg-[#DDE404] uppercase cursor-pointer hover:bg-[#DDE404]/90 sm:pt-2.5 sm:pb-3 pt-2.5 pb-1.5 sm:px-12 px-8 sm:text-xl shadow-xl border border-white rounded-xl sequel-95 text-base custom-box-shadow"
          >
            See All Faq's
          </Link>
        </div>
      </div>
    </section>
  );
}
