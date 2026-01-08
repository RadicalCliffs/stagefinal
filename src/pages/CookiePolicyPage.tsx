const CookiePolicyPage = () => {
  return (
    <main className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="sequel-95 text-4xl md:text-6xl text-white mb-8 text-center uppercase">
        Cookie Policy
      </h1>

      <div className="space-y-6">
        <p className="sequel-45 text-base text-white/90 leading-relaxed">
          THEPRIZE.IO uses cookies to enhance your experience, improve functionality, and analyze site usage. By continuing to use our site, you consent to our use of cookies.
        </p>

        <div className="mt-8">
          <h2 className="sequel-95 text-3xl md:text-4xl text-white mb-6">
            1. What Are Cookies?
          </h2>
          <p className="sequel-45 text-base text-white/90 leading-relaxed">
            Cookies are small data files stored on your device that help us remember your preferences and recognize your browser upon return.
          </p>
        </div>

        <div className="mt-8">
          <h2 className="sequel-95 text-3xl md:text-4xl text-white mb-6">
            2. Types of Cookies We Use
          </h2>
          <div className="space-y-4">
            <div>
              <h3 className="sequel-75 text-xl text-white mb-2">Essential Cookies:</h3>
              <p className="sequel-45 text-base text-white/90 leading-relaxed pl-4">
                Required for the operation of our site.
              </p>
            </div>
            <div>
              <h3 className="sequel-75 text-xl text-white mb-2">Performance Cookies:</h3>
              <p className="sequel-45 text-base text-white/90 leading-relaxed pl-4">
                Collect data on site usage to help us improve user experience.
              </p>
            </div>
            <div>
              <h3 className="sequel-75 text-xl text-white mb-2">Functional Cookies:</h3>
              <p className="sequel-45 text-base text-white/90 leading-relaxed pl-4">
                Enable personalized features, such as saving your competition entries.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="sequel-95 text-3xl md:text-4xl text-white mb-6">
            3. Managing Your Cookies
          </h2>
          <p className="sequel-45 text-base text-white/90 leading-relaxed">
            You can control your cookie preferences through your browser settings. Disabling certain cookies may limit your ability to use all features of our platform.
          </p>
        </div>

        <div className="mt-8">
          <h2 className="sequel-95 text-3xl md:text-4xl text-white mb-6">
            4. Third-Party Cookies
          </h2>
          <p className="sequel-45 text-base text-white/90 leading-relaxed">
            We may partner with third-party providers for analytics. These providers may use cookies as described in their respective privacy policies.
          </p>
        </div>

        <div className="mt-8">
          <h2 className="sequel-95 text-3xl md:text-4xl text-white mb-6">
            Contact Us
          </h2>
          <p className="sequel-45 text-base text-white/90 leading-relaxed">
            For questions regarding our Cookies Policy, email us at{' '}
            <a href="mailto:contact@theprize.io" className="text-[#EF008F] hover:underline">
              contact@theprize.io
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
};

export default CookiePolicyPage;
