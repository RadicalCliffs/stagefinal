import type { EntryTicket } from "../../models/models";
import PrizeTicketGrid from "./PrizeTicketsGrid";

interface PrizesDetailsProps {
  tickets?: EntryTicket[];
}

const PrizesDetails: React.FC<PrizesDetailsProps> = ({ tickets = [] }) => {
  return (
    <div>
      <PrizeTicketGrid tickets={tickets} />
    </div>
  );
};

export default PrizesDetails;
