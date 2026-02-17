import { partnersLogoDesktop, partnersLogoMobile } from "../assets/images";

const Partners = () => {
  return (
    <div>
      <img src={partnersLogoDesktop} alt="partners" className="mx-auto py-4 hidden md:block" />
      <img src={partnersLogoMobile} alt="partners" className="mx-auto py-4 md:hidden" />
    </div>
  );
};

export default Partners;
