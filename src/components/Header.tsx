import { Link, NavLink } from "react-router";
import {
  iconsDropdown,
  logo,
  mobileLogo,
  powerButton,
} from "../assets/images";
import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
import Activity from "./Activity";
import LoggedInUserBtn from "./LoggedInUserBtn";
import { CirclePlus, Menu } from "lucide-react";
import { useAuthUser } from "../contexts/AuthContext";
import SocialDropdown from "./SocialDropdown";
import { useClickOutside } from "../hooks/useHandleClickOutside";

// Lazy load the auth modal - only loaded when user clicks Login
const NewAuthModal = lazy(() => import("./NewAuthModal"));
const BaseWalletAuthModal = lazy(() => import("./BaseWalletAuthModal"));

const Header: React.FC = () => {
  const navItems: { label: string; path: string }[] = [
    { label: "Home", path: "/" },
    { label: "Competitions", path: "/competitions" },
    { label: "How to Play", path: "/how-to-play" },
    { label: "Winners", path: "/winners" },
    { label: "About", path: "/about" },
  ];

  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showBaseWalletAuthModal, setShowBaseWalletAuthModal] = useState(false);
  const [baseWalletAuthOptions, setBaseWalletAuthOptions] = useState<any>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { authenticated, ready, logout } = useAuthUser();

  // Listen for open-auth-modal events from other components (e.g., when login() is called)
  useEffect(() => {
    const handleOpenAuthModal = () => {
      if (!authenticated && ready) {
        setShowAuthModal(true);
      }
    };

    window.addEventListener('open-auth-modal', handleOpenAuthModal);
    return () => {
      window.removeEventListener('open-auth-modal', handleOpenAuthModal);
    };
  }, [authenticated, ready]);

  // Listen for open-base-wallet-auth events (triggered when user needs dedicated CDP wallet auth flow)
  // CRITICAL: This must properly pass through the isReturningUser flag to show correct UI
  useEffect(() => {
    const handleOpenBaseWalletAuth = (event: CustomEvent) => {
      const options = event.detail || {};
      console.log('[Header] Opening Base wallet auth modal with options:', {
        isReturningUser: options.isReturningUser,
        email: options.email ? '***' : undefined,
        resumeSignup: options.resumeSignup,
        hasReturningUserWalletAddress: !!options.returningUserWalletAddress,
      });

      // Ensure NewAuthModal is fully closed before opening BaseWalletAuthModal
      // to prevent both modals being visible simultaneously
      setShowAuthModal(false);

      // Small delay to ensure state updates are processed before opening new modal
      // This prevents race conditions where both modals might flash on screen
      setTimeout(() => {
        setBaseWalletAuthOptions(options);
        setShowBaseWalletAuthModal(true);
      }, 50);
    };

    window.addEventListener('open-base-wallet-auth', handleOpenBaseWalletAuth as EventListener);
    return () => {
      window.removeEventListener('open-base-wallet-auth', handleOpenBaseWalletAuth as EventListener);
    };
  }, []);

  // Prevent opening Base auth modal if user is already authenticated
  // Also prevent showing auth modal during initial auth check to avoid flicker on refresh
  const handleAuthModalOpen = () => {
    if (!authenticated && ready) {
      setShowAuthModal(true);
    }
  };

  // Handle logout when user clicks the power/standby button
  const handleLogout = async () => {
    if (!authenticated || isLoggingOut) return;

    try {
      setIsLoggingOut(true);
      await logout();
      // Storage clearing and redirect handled by logout function in AuthContext
    } catch (error) {
      console.error('Header logout error:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const isLoggedIn = authenticated;

  useEffect(() => {
    console.log('Base auth status:', { ready, authenticated });
  }, [ready, authenticated]);

  const [showSocialDropdown, setShowSocialDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(dropdownRef, () => setShowSocialDropdown(false));

  return (
    <>
      <header className="flex xl:justify-center relative z-40 bg-transparent xl:bg-transparent">
        <Activity mode={isMenuOpen ? "visible" : "hidden"}>
          <div
            onClick={() => {
              setIsMenuOpen(false);
            }}
            className="inset-0 backdrop-blur-md w-full z-30 fixed overflow-hidden"
          ></div>
        </Activity>

        {/* Mobile header - constrained to match hero section width */}
        <div className="flex justify-between w-full max-w-7xl mx-auto px-6 py-4 items-center relative z-50 xl:hidden bg-[#1A1A1A] rounded-b-xl">
          <Link to="/" className="xl:hidden block">
            <img src={mobileLogo} alt="PrizeIO mobile logo" />
          </Link>

          {/* Mobile hamburger toggle */}
          {
            isMenuOpen ? <CirclePlus className="rotate-45 cursor-pointer hover:opacity-80" color="#DDE404" size={30} onClick={() => setIsMenuOpen(false)}/> : <Menu
            color="white"
            size={30}
            className="cursor-pointer"
            onClick={() => setIsMenuOpen(true)}
          />
          }
          

          <Activity mode={isMenuOpen ? "visible" : "hidden"}>
            <nav className="absolute left-0 right-0 top-12 py-6 bg-[#232323] z-[60] max-h-[calc(100vh-5rem)] overflow-y-auto">
              <ul className="flex flex-col sequel-45 text-white sm:items-center sm:pl-0 pl-8 items-start space-y-2 uppercase">
                {navItems.map(({ label, path }) => (
                  <li key={path}>
                    <NavLink
                      to={path}
                      onClick={() => setIsMenuOpen(false)}
                      className={({ isActive }) =>
                        isActive
                          ? "text-[#DDE404] font-semibold"
                          : "hover:text-[#DDE404]"
                      }
                      end={path === "/"}
                    >
                      {label}
                    </NavLink>
                  </li>
                ))}

                {/* User Dashboard link for logged-in users */}
                {isLoggedIn && (
                  <li>
                    <NavLink
                      to="/dashboard/entries"
                      onClick={() => setIsMenuOpen(false)}
                      className={({ isActive }) =>
                        isActive
                          ? "text-[#DDE404] font-semibold"
                          : "hover:text-[#DDE404]"
                      }
                    >
                      User Dashboard
                    </NavLink>
                  </li>
                )}
              </ul>

              {/* Login/Logout section */}
              {isLoggedIn ? (
                <div className="mt-8 flex flex-col items-center gap-4 px-8 sm:px-0">
                  {/* Show LoggedInUserBtn for account info */}
                  <div className="w-full flex justify-center">
                    <LoggedInUserBtn />
                  </div>
                  {/* Dedicated mobile logout button for easier access */}
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleLogout();
                    }}
                    disabled={isLoggingOut}
                    className="bg-[#EF008F] hover:bg-[#EF008F]/90 text-white sequel-75 w-full sm:w-auto px-8 py-3 rounded-sm uppercase text-sm disabled:opacity-50"
                  >
                    {isLoggingOut ? 'Logging Out...' : 'Log Out'}
                  </button>
                </div>
              ) : (
                <div className="text-center xl:mt-12 mt-8">
                  <button
                    onClick={handleAuthModalOpen}
                    className="bg-[#DDE404] sequel-75 sm:w-fit w-11/12 mx-auto flex items-center justify-center 2xl:text-base text-sm uppercase rounded-sm py-3 px-14 cursor-pointer hover:bg-[#DDE404]/90"
                  >
                    Login / Sign Up
                  </button>
                </div>
              )}

              <SocialDropdown />
            </nav>
          </Activity>
        </div>

        {/* Desktop header - constrained to match hero section width (max-w-7xl = 80rem = 1280px) */}
        <div className="relative max-w-7xl mx-auto xl:block hidden w-full">
          <div className="absolute z-[10] left-0 xl:block hidden">
            <svg
              width="20"
              height="70"
              viewBox="0 0 8.1 71.02"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="block"
              preserveAspectRatio="none"
            >
              <path
                d="M0.827759 63.7586L0.82776 60.9558L0.825807 60.9558C2.52698 60.9558 3.90552 59.5773 3.90552 57.8761C3.90552 56.1749 2.52698 54.7964 0.825807 54.7964L0.825807 52.0948C2.52698 52.0948 3.90552 50.7163 3.90552 49.0152C3.90552 47.314 2.52698 45.9355 0.825808 45.9355L0.825808 43.2339C2.52698 43.2339 3.90552 41.8554 3.90552 40.1542C3.90552 38.4531 2.52698 37.0746 0.825809 37.0746L0.825809 34.3729C2.52698 34.3729 3.90552 32.9944 3.90552 31.2933C3.90552 29.5921 2.52698 28.2136 0.825809 28.2136L0.82581 25.512C2.52698 25.512 3.90552 24.1335 3.90552 22.4323C3.90552 20.7312 2.52698 19.3527 0.82581 19.3527L0.82581 16.651C2.52698 16.651 3.90552 15.2725 3.90552 13.5714C3.90552 11.8702 2.52698 10.4917 0.825811 10.4917L0.825811 7.68891C4.83533 7.68891 8.0868 4.43741 8.0868 0.427939L8.0868 71.0196C8.08875 67.0101 4.83728 63.7586 0.827759 63.7586Z"
                fill="#1A1A1A"
              />
            </svg>
          </div>

          <div className="bg-[#1A1A1A] flex items-center gap-18 min-h-[70px] rounded-tr-lg rounded-br-lg w-[calc(100%-20px)] ml-[20px] pr-4">
            <Link to="/" className="ml-4 flex-shrink-0">
              <img src={logo} alt="PrizeIO logo" />
            </Link>
            <nav className="flex-1">
              <ul className="flex sequel-45 text-white 2xl:gap-8 gap-6 2xl:text-sm text-xs uppercase">
                {navItems.map(({ label, path }) => (
                  <li key={path}>
                    <NavLink
                      to={path}
                      className={({ isActive }) =>
                        isActive
                          ? "text-[#DDE404] font-semibold"
                          : "hover:text-[#DDE404]"
                      }
                      end={path === "/"}
                    >
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="relative" ref={dropdownRef}  onClick={() => setShowSocialDropdown(prev => !prev)}>
                <img
                  src={iconsDropdown}
                  alt="language dropdown"
                  className="cursor-pointer"
                />
                {showSocialDropdown ? (
                  <div className={`absolute -top-1`}>
                    <SocialDropdown />
                  </div>
                ) : (
                  ""
                )}
              </div>
              {isLoggedIn ? (
                <LoggedInUserBtn />
              ) : (
                <button
                  onClick={handleAuthModalOpen}
                  className="bg-[#DDE404] sequel-75 2xl:text-base text-sm uppercase rounded-sm py-3 px-8 cursor-pointer hover:bg-[#DDE404]/90 flex items-center justify-center"
                >
                  Login / Sign Up
                </button>
              )}

              {/* Power/Standby button - Only show for logged-in users, triggers logout */}
              {isLoggedIn && (
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="w-8 h-8 cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-50"
                  title="Log Out"
                  aria-label="Log out of your account"
                >
                  <img alt="Log out" className="w-full h-full" src={powerButton} />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {showAuthModal && (
        <Suspense fallback={null}>
          <NewAuthModal
            isOpen={showAuthModal}
            onClose={() => setShowAuthModal(false)}
          />
        </Suspense>
      )}

      {showBaseWalletAuthModal && (
        <Suspense fallback={null}>
          <BaseWalletAuthModal
            isOpen={showBaseWalletAuthModal}
            onClose={() => {
              setShowBaseWalletAuthModal(false);
              setBaseWalletAuthOptions(null);
            }}
            options={baseWalletAuthOptions}
          />
        </Suspense>
      )}
    </>
  );
};

export default Header;
