import { partnersLogo } from "../assets/images";
import Heading from "./Heading";

const Partners = () => {
  return (
    <div className="bg-[#202020] border-t-4 border-[#DDE404] rounded-b-xl text-white">
      <Heading
        text="Our Partners"
        classes="text-white sm:mt-6 mt-4 md:text-[2.1rem] mb-4"
      />
      <img src={partnersLogo} alt="partners" className="mx-auto pb-4" />
    </div>
  );
};

export default Partners;
