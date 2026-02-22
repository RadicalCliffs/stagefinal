import { Link } from "react-router";
import { arrow } from "../assets/images";
import type { FairStepsProps } from "../models/models";

const FairSteps = ({
  outerContainerClasses,
  titleDesktop,
  titleMobile,
  steps,
  linkText = "Learn More",
  linkTo = "/",
  primaryColor = "#EF008F",
  showSteps = true,
  containerClasses,
  cardClasses,
  titleClasses,
  descriptionClasses,
  bgImageClasses,
  showInstructionLink = true,
  showSeparator = true
}: FairStepsProps) => {
  return (
    <div className={`py-10 max-w-7xl mx-auto 2xl:px-0 sm:px-4 ${outerContainerClasses}`}>
      {/* Headings */}
      <h1 className="text-white xl:block whitespace-pre-line hidden uppercase text-4xl leading-14 sequel-95 text-center">
        {titleDesktop}
      </h1>
      <h1 className="text-white xl:hidden block uppercase sm:text-4xl text-2xl leading-14 sequel-75 text-center">
        {titleMobile}
      </h1>

      {/* Steps */}
      <div className={`lg:flex grid md:grid-cols-2 sm:mt-14 mt-6 text-center text-white xl:gap-0 gap-5 2xl:max-w-11/12 mx-auto ${containerClasses}`}>
        {steps.map((step, index) => (
          <div key={index} className={`flex w-full ${cardClasses}`}>
            {
              !showSeparator && <span className="absolute sequel-45 text-sm border border-white rounded-full left-4 top-4 z-10 w-8 h-8 pb-1 flex items-center justify-center">{index + 1}</span>
            }

            {/* Step Card */}
            <div
              className="px-4 py-8 rounded-2xl w-full relative overflow-hidden custom-box-shadow"
              style={{ backgroundColor: primaryColor }}
            >
              <img className="mx-auto mb-4" src={step.icon} alt="icon" />
              <h1 className={`sequel-75 sm:text-2xl text-xl mb-4 whitespace-pre-line ${titleClasses}`}>
                {step.title}
              </h1>
              {
                showSeparator && <div className="w-6/12 mx-auto h-px bg-white my-4"></div>
              }
              <p className={`sequel-45 text-sm leading-loose ${descriptionClasses}`}>{step.description}</p>

              {step.bgImage && (
                <img
                  src={step.bgImage}
                  alt="background"
                  className={`absolute top-8 left-8 z-10 ${bgImageClasses}`}
                />
              )}
            </div>
            {
              showSteps && <img
                src={arrow}
                alt="arrow"
                className={`max-w-4 w-full self-center xl:block hidden mx-4 ${index !== steps.length - 1 ? 'opacity-100' : 'opacity-0'}`}
              />
            }

          </div>
        ))}
      </div>


      {showInstructionLink && <p className="sequel-45 text-center mt-10 sm:text-lg text-white sm:leading-none leading-loose">
        For more information on how to enter see{" "}
        <Link
          to={linkTo}
          className="text-[#DDE404] font-bold uppercase hover:text-[#DDE404]/90"
        >
          {linkText}
        </Link>
      </p>}

    </div>
  );
};

export default FairSteps;
