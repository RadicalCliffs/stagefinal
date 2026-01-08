import privacyText from '../assets/text/Privacy.txt?raw';

const PrivacyPolicyPage = () => {
  const content = privacyText;

  const formatContent = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactElement[] = [];

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        elements.push(<div key={index} className="h-4" />);
        return;
      }

      if (trimmedLine === 'Introduction' || trimmedLine.match(/^\d+\./)) {
        elements.push(
          <h2 key={index} className="sequel-95 text-3xl md:text-4xl text-white mb-6 mt-8">
            {trimmedLine}
          </h2>
        );
      } else if (
        trimmedLine.startsWith('Purpose of') ||
        trimmedLine.startsWith('Controller') ||
        trimmedLine.startsWith('Contact details') ||
        trimmedLine.startsWith('Changes to') ||
        trimmedLine.startsWith('Third-party links') ||
        trimmedLine.startsWith('Personal data') ||
        trimmedLine.startsWith('If you fail') ||
        trimmedLine.startsWith('Purposes for') ||
        trimmedLine.startsWith('Marketing') ||
        trimmedLine.startsWith('Promotional offers') ||
        trimmedLine.startsWith('Third-party marketing') ||
        trimmedLine.startsWith('Opting out') ||
        trimmedLine.startsWith('Cookies') ||
        trimmedLine.startsWith('Change of purpose') ||
        trimmedLine.startsWith('LAWFUL BASIS') ||
        trimmedLine.startsWith('THIRD PARTIES') ||
        trimmedLine.startsWith('External Third Parties') ||
        trimmedLine.startsWith('YOUR LEGAL RIGHTS') ||
        trimmedLine.startsWith('How long will') ||
        trimmedLine.startsWith('No fee usually') ||
        trimmedLine.startsWith('What we may need') ||
        trimmedLine.startsWith('Time limit to')
      ) {
        elements.push(
          <h3 key={index} className="sequel-75 text-xl md:text-2xl text-white mb-4 mt-6">
            {trimmedLine}
          </h3>
        );
      } else if (trimmedLine.startsWith('•')) {
        elements.push(
          <p key={index} className="sequel-45 text-base text-white/90 mb-2 pl-4">
            {trimmedLine}
          </p>
        );
      } else if (trimmedLine.startsWith('Purpose/Activity') || trimmedLine.startsWith('Type of data') || trimmedLine.startsWith('Lawful basis')) {
        elements.push(
          <p key={index} className="sequel-75 text-lg text-white mb-3 mt-4">
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
        Privacy Policy
      </h1>

      <div className="space-y-2">
        {content ? formatContent(content) : (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#EF008F]"></div>
            <p className="sequel-45 text-white mt-4">Loading privacy policy...</p>
          </div>
        )}
      </div>
    </main>
  );
};

export default PrivacyPolicyPage;
