import { Link } from 'react-router';
import { Home, ArrowLeft, Search } from 'lucide-react';

const NotFoundPage = () => {
  return (
    <>
      {/* Global background */}
      <div className="custom-landing-page-background bg-full-size absolute inset-0 w-full h-full"></div>
      
      <div className="relative min-h-[70vh] flex items-center justify-center px-4">
        <div className="max-w-2xl mx-auto text-center">
          {/* 404 Badge */}
          <div className="mb-8">
            <span className="inline-block px-6 py-2 bg-[#DDE404]/10 border border-[#DDE404]/30 rounded-full">
              <span className="text-[#DDE404] sequel-75 text-sm uppercase tracking-wider">Error 404</span>
            </span>
          </div>

          {/* Main heading */}
          <h1 className="text-[#DDE404] sequel-95 text-5xl md:text-7xl uppercase mb-6">
            Page Not Found
          </h1>

          {/* Apology message */}
          <div className="space-y-4 mb-10">
            <p className="text-white sequel-45 text-lg md:text-xl">
              We're sorry, but the page you're looking for doesn't exist or has been moved.
            </p>
            <p className="text-gray-400 sequel-45 text-base">
              Don't worry though — you can head back home and find what you're looking for, 
              or check out our live competitions for a chance to win big.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#DDE404] text-[#1A1A1A] sequel-75 uppercase text-sm rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
            >
              <Home size={18} />
              <span>Go Home</span>
            </Link>

            <Link
              to="/competitions"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 border border-white/30 text-white sequel-75 uppercase text-sm rounded-xl transition-all duration-200 hover:bg-white/10 active:scale-[0.98]"
            >
              <Search size={18} />
              <span>View Competitions</span>
            </Link>
          </div>

          {/* Back button */}
          <button
            onClick={() => window.history.back()}
            className="mt-8 inline-flex items-center gap-2 text-gray-400 hover:text-white sequel-45 text-sm transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Go back to previous page</span>
          </button>

          {/* Decorative element */}
          <div className="mt-16 flex justify-center gap-2">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-[#DDE404]"
                style={{ opacity: 0.2 + (i * 0.2) }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default NotFoundPage;
