import {
    applePay,
    discord,
    footerLogo,
    googlePay,
    instagram,
    masterCardLogo,
    telegram,
    twitter,
    visaLogo,
} from "../assets/images";
import { NavLink } from "react-router";

const Footer = () => {

    const links = [
        { name: "Home", path: "/" },
        { name: "Competitions", path: "/competitions" },
        { name: "How to Play", path: "/how-to-play" },
        { name: "Winners", path: "/winners" },
    ];

    return (
        <div className="bg-[#1A1A1A] py-10 xl:px-0 px-4">
            {/* Desktop Layout */}
            <div className="hidden md:grid lg:grid-cols-3 md:grid-cols-2 max-w-7xl mx-auto text-white gap-10">
                {/* Left Section */}
                <div>
                    <img className="sm:w-[250px] w-full" src={footerLogo} alt="footer-logo" />
                    <p className="sequel-45 leading-loose my-10">
                        <span>Content is not intended for an audience under</span>{" "}
                        <span className="text-[0.6rem]">18 years of age.</span>{" "}
                        <a href="https://www.gamcare.org.uk" className="underline">
                            www.gamcare.org.uk
                        </a>
                    </p>
                    <div className="flex items-center gap-4 mt-1">
                        <img src={masterCardLogo} alt="mastercard" className="rounded py-[5px] px-2" />
                        <img src={visaLogo} alt="visa" className="rounded py-[5px] px-2" />
                        <img src={applePay} alt="applePay" className="rounded py-[5px] px-2" />
                        <img src={googlePay} alt="googlePay" className="rounded py-[5px] px-2" />
                    </div>
                </div>

                {/* Middle Section */}
                <div className="xl:ml-40 md:ml-20">
                    <h1 className="sequel-75 uppercase sm:text-xl text-lg">Quick Links</h1>
                    <ul className="sequel-45 uppercase space-y-4 sm:mt-10 mt-6 sm:text-lg">
                        {links.map(({ path, name }) => {
                            return (
                                <li key={name}>
                                    <NavLink
                                        to={path}
                                        className={({ isActive }) =>
                                            isActive
                                                ? "text-[#DDE404] font-semibold"
                                                : "hover:text-[#DDE404]"
                                        }
                                        end={path === "/"}
                                    >
                                        {name}
                                    </NavLink>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                {/* Right Section */}
                <div className="lg:text-right">
                    <h1 className="sequel-75 uppercase sm:text-xl text-lg">Contacts</h1>
                    <div className="sm:mt-10 mt-6 sm:text-lg text-base sequel-45 capitalize space-y-4">
                        <a className="block" href="mailto:press@theprize.io">
                            Press@theprize.io
                        </a>
                        <a className="block" href="mailto:contact@theprize.io">
                            Contact@theprize.io
                        </a>
                        <a className="block" href="https://t.me/theprizeannouncements" target="_blank" rel="noopener noreferrer">
                            Telegram Tech Support
                        </a>
                    </div>
                    <div className="flex items-center gap-4 lg:justify-end mt-10">
                        <a href="https://www.instagram.com/theprize.io/" className="bg-[#EF008F] w-12 h-12 rounded-lg flex items-center justify-center">
                            <img src={instagram} alt="instagram" className="w-6 h-6" />
                        </a>
                        <a href="https://t.me/theprizeannouncements" className="bg-[#EF008F] w-12 h-12 rounded-lg flex items-center justify-center">
                            <img src={telegram} alt="telegram" className="w-6 h-6" />
                        </a>
                        <a href="https://x.com/the_prize_io" className="bg-[#EF008F] w-12 h-12 rounded-lg flex items-center justify-center">
                            <img src={twitter} alt="X / Twitter" className="w-6 h-6" />
                        </a>
                        <a href="https://discord.com/invite/theprize" className="bg-[#EF008F] w-12 h-12 rounded-lg flex items-center justify-center">
                            <img src={discord} alt="discord" className="w-6 h-6" />
                        </a>
                    </div>
                </div>
            </div>

            {/* Mobile Layout - matches screenshot */}
            <div className="md:hidden max-w-7xl mx-auto text-white">
                <div className="grid grid-cols-2 gap-8 mb-8">
                    {/* Quick Links */}
                    <div>
                        <h1 className="sequel-75 uppercase text-base mb-4">Quick Links</h1>
                        <ul className="sequel-45 uppercase space-y-3 text-sm text-[#DDE404]">
                            {links.map(({ path, name }) => {
                                return (
                                    <li key={name}>
                                        <NavLink
                                            to={path}
                                            className="hover:text-[#c7cc04]"
                                            end={path === "/"}
                                        >
                                            {name}
                                        </NavLink>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    {/* Contact */}
                    <div>
                        <h1 className="sequel-75 uppercase text-base mb-4">Contact</h1>
                        <div className="sequel-45 text-sm space-y-3">
                            <a className="block" href="mailto:press@theprize.io">
                                Press@theprize.io
                            </a>
                            <a className="block" href="https://t.me/theprizeannouncements" target="_blank" rel="noopener noreferrer">
                                Telegram Tech Support
                            </a>
                            <a className="block" href="mailto:contact@theprize.io">
                                Contact@theprize.io
                            </a>
                        </div>
                    </div>
                </div>

                {/* Bottom text */}
                <p className="sequel-45 leading-relaxed mb-6">
                    <span className="text-xs">Content is not intended for an audience under</span>{" "}
                    <span className="text-[0.4rem]">18 years of age.</span>{" "}
                    <a href="https://www.gamcare.org.uk" className="underline text-xs">
                        www.gamcare.org.uk
                    </a>
                </p>

                {/* Social icons */}
                <div className="flex items-center gap-3 mb-3">
                    <a href="https://t.me/theprizeannouncements" className="bg-[#EF008F] w-10 h-10 rounded-lg flex items-center justify-center">
                        <img src={telegram} alt="telegram" className="w-6 h-6" />
                    </a>
                    <a href="https://x.com/the_prize_io" className="bg-[#EF008F] w-10 h-10 rounded-lg flex items-center justify-center">
                        <img src={twitter} alt="X / Twitter" className="w-6 h-6" />
                    </a>
                    <a href="https://www.instagram.com/theprize.io/" className="bg-[#EF008F] w-10 h-10 rounded-lg flex items-center justify-center">
                        <img src={instagram} alt="instagram" className="w-6 h-6" />
                    </a>
                </div>

                {/* Payment methods */}
                <div className="flex items-center gap-3 mb-3">
                    <img src={visaLogo} alt="visa" className="rounded py-[5px] px-2" />
                    <img src={masterCardLogo} alt="mastercard" className="rounded py-[5px] px-2" />
                    <img src={applePay} alt="applePay" className="rounded py-[5px] px-2" />
                    <img src={googlePay} alt="googlePay" className="rounded py-[5px] px-2" />
                </div>
            </div>

            {/* Footer bottom links */}
            <div className="sequel-45 text-white sm:text-base text-sm leading-loose sm:text-center md:mt-16 mt-6 space-x-1">
                <NavLink
                    to="/cookie-policy"
                    className="hover:text-[#DDE404] transition-colors duration-200"
                >
                    Cookie Policy
                </NavLink>
                <span>|</span>
                <NavLink
                    to="/privacy-policy"
                    className="hover:text-[#DDE404] transition-colors duration-200"
                >
                    Privacy Policy
                </NavLink>
                <span>|</span>
                <NavLink
                    to="/terms-and-conditions"
                    className="hover:text-[#DDE404] transition-colors duration-200"
                >
                    Terms & Conditions
                </NavLink>
                <span>|</span>
                <NavLink
                    to="/terms-of-use"
                    className="hover:text-[#DDE404] transition-colors duration-200"
                >
                    Terms of Use
                </NavLink>
                <span>|</span>
                <NavLink
                    to="/acceptable-use"
                    className="hover:text-[#DDE404] transition-colors duration-200"
                >
                    Acceptable Use
                </NavLink>
            </div>
        </div>
    );
};

export default Footer;
