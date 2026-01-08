import { crown,  rocket, ticket } from "../../assets/images";
import type { Step } from "../../models/models";
import FairSteps from "../FairSteps";

const InstantWinHowItWorks = () => {
    const steps: Step[] = [
        {
            icon: ticket,
            title: "Buy Your\nTickets",
        },
        {
            icon: crown,
            title: "Reveal If\nYou've Won",
        },
        {
            icon: rocket,
            title: "Claim &\nYour Prize",
        },
    ];

    return (
        <FairSteps
            titleDesktop={"How it Works"}
            titleMobile={"How it Works"}
            steps={steps}
            primaryColor="#454545"
            titleClasses="uppercase !text-lg sequel-95 mt-7"
            containerClasses="xl:gap-0"
            showInstructionLink={false}
            showSeparator={false}
            cardClasses="relative"
            outerContainerClasses="!max-w-6xl"
        />
    );
};

export default InstantWinHowItWorks;
