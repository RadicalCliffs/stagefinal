import { useEffect, useRef } from 'react';
import termsText from '../assets/text/Terms.txt?raw';

const TermsAndConditionsPage = () => {
  const content = termsText;
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Handle scrolling to hash on page load
    const hash = window.location.hash;
    if (hash && contentRef.current) {
      // Add a small delay to ensure content is rendered
      setTimeout(() => {
        const targetElement = contentRef.current?.querySelector(hash);
        if (targetElement) {
          targetElement.scrollIntoView({ 
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest'
          });
        } else {
          // If specific element not found, try to find section by number (e.g., 3.11)
          const sectionNumber = hash.replace('#', '');
          const sectionElements = contentRef.current?.querySelectorAll('[data-section]');
          sectionElements?.forEach((element) => {
            if (element.getAttribute('data-section') === sectionNumber) {
              element.scrollIntoView({ 
                behavior: 'smooth',
                block: 'start',
                inline: 'nearest'
              });
            }
          });
        }
      }, 100);
    }
  }, []);

  const formatContent = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactElement[] = [];

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        elements.push(<div key={index} className="h-4" />);
        return;
      }

      if (trimmedLine.match(/^\d+\.\s+[A-Z]/)) {
        // Main sections like "1. The Promoter"
        const sectionMatch = trimmedLine.match(/^(\d+)\./);
        const sectionId = sectionMatch ? sectionMatch[1] : '';
        elements.push(
          <h2 key={index} id={sectionId} data-section={sectionId} className="sequel-95 text-3xl md:text-4xl text-white mb-6 mt-8">
            {trimmedLine}
          </h2>
        );
      } else if (trimmedLine.match(/^\d+\.\d+/)) {
        // Sub-sections like "3.11 You may enter the competition for free..."
        const sectionMatch = trimmedLine.match(/^(\d+\.\d+)/);
        const sectionId = sectionMatch ? sectionMatch[1] : '';
        elements.push(
          <h3 key={index} id={sectionId} data-section={sectionId} className="sequel-75 text-xl md:text-2xl text-white mb-4 mt-6">
            {trimmedLine}
          </h3>
        );
      } else if (trimmedLine.match(/^\([a-z]\)/)) {
        elements.push(
          <p key={index} className="sequel-45 text-base text-white/90 mb-2 pl-8">
            {trimmedLine}
          </p>
        );
      } else if (trimmedLine.match(/^\([ivx]+\)/)) {
        elements.push(
          <p key={index} className="sequel-45 text-base text-white/90 mb-2 pl-12">
            {trimmedLine}
          </p>
        );
      } else {
        elements.push(
          <p key={index} className="sequel-45 text-base text-white/90 mb-3 leading-relaxed">
            {trimmedLine}
          </p>
        );
      }
    });

    return elements;
  };

  return (
    <main className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="sequel-95 text-4xl md:text-6xl text-white mb-8 text-center uppercase">
        Terms & Conditions
      </h1>

      <div ref={contentRef} className="space-y-2">
        {content ? formatContent(content) : (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#EF008F]"></div>
            <p className="sequel-45 text-white mt-4">Loading terms and conditions...</p>
          </div>
        )}
      </div>
    </main>
  );
};

export default TermsAndConditionsPage;
