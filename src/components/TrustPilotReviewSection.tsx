import { trustpilotIsolation, trustpilotMobile } from "../assets/images";

export default function TrustpilotReviewSection() {
  return (
    <>
      {/* Desktop version */}
      <a
        href="https://uk.trustpilot.com/review/theprize.io"
        target="_blank"
        rel="noopener noreferrer"
        className="sm:flex hidden justify-center"
      >
        <img
          src={trustpilotIsolation}
          alt="Trustpilot Reviews"
          className="max-h-[110px] w-auto"
        />
      </a>
      {/* Mobile version */}
      <a
        href="https://uk.trustpilot.com/review/theprize.io"
        target="_blank"
        rel="noopener noreferrer"
        className="sm:hidden block"
      >
        <img
          src={trustpilotMobile}
          alt="Trustpilot Reviews"
          className="max-w-full h-auto"
        />
      </a>
    </>
  );
}
