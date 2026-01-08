import type { Ticket } from "../../models/models";
import PrizeTicketGrid from "./PrizeTicketsGrid";

interface PrizesDetailsProps {
  tickets?: Ticket[];
}

const PrizesDetails: React.FC<PrizesDetailsProps> = ({ tickets = [] }) => {
  return (
    <div>
      <PrizeTicketGrid tickets={tickets} />
    </div>
  );
};

export default PrizesDetails;
